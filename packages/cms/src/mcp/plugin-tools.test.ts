/**
 * A plugin's MCP tool from the outside: an MCP client lists and calls it
 * under the plugin's prefix while the plugin is enabled, and core holds it to
 * the scope check, the per-token limit and the record without the plugin
 * doing anything for it.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import type { Scope } from '../indieauth/request.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import { setPluginEnabled } from '../plugins/enabled.ts';
import { createUser, findUser } from '../site/users.ts';
import { readActivityLog } from '../web/indieauth-activity-log.ts';
import { MCP_CALLS_PER_WINDOW } from './endpoint.ts';
import { JSON_RPC_ERRORS } from './protocol.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const MCP = '/_geekity/mcp';
const APP = 'https://claude.example/client.json';
const ECHO = '@acme/plugin-echo';
const TOOL_NAME = 'acme_plugin_echo__echo_back';

const echo = definePlugin({
  name: ECHO,
  version: '1.0.0',
  label: 'Echo',
  description: 'Says back what it is told.',
  hostApi: HOST_API_VERSION,
  register(host) {
    host.tool({
      id: 'echo-back',
      title: 'Echo back',
      description: 'Says back the text, with who asked.',
      scope: 'inspect',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          username: { type: 'string' },
          client: { type: 'string' },
          clientName: { type: 'string' },
          timezone: { type: 'string' },
          baseUrl: { type: 'string' },
        },
        required: ['text', 'username', 'client', 'timezone', 'baseUrl'],
      },
      run: ({ text }, { user, client, clientName, timezone, site }) =>
        Promise.resolve({
          ok: true,
          summary: `${user.username} said ${text}.`,
          structured: {
            text,
            username: user.username,
            client,
            ...(clientName === undefined ? {} : { clientName }),
            timezone,
            baseUrl: site.baseUrl,
          },
        }),
    });
  },
});

interface Site {
  readonly cms: Cms;
  readonly contentDir: string;
  readonly dataDir: string;
  readonly token: (scopes: readonly Scope[]) => Promise<string>;
}

async function site(): Promise<Site> {
  const contentDir = await box.dir('geekity-mcp-plugin-content-');
  const dataDir = await box.dir('geekity-mcp-plugin-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({
      title: 'A Site',
      author: 'ada',
      timezone: 'Europe/London',
      plugins: { [ECHO]: { enabled: true } },
    }),
  );
  await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  const cms = await box.open({ contentDir, dataDir, baseUrl: BASE, plugins: [echo] });
  return {
    cms,
    contentDir,
    dataDir,
    async token(scopes) {
      const ada = findUser(dataDir, 'ada');
      assert.ok(ada !== undefined);
      const issued = await issueTokens(
        dataDir,
        {
          clientId: APP,
          clientName: 'Claude Code',
          redirectUri: 'http://localhost:4567/callback',
          codeChallenge: { method: 'S256', value: 'unused' },
          userId: ada.id,
          me: `${BASE}/`,
          scopes,
          resource: `${BASE}${MCP}`,
        },
        new Date(),
      );
      return issued.accessToken;
    },
  };
}

let nextId = 1;

async function rpc(
  cms: Cms,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await cms.app.request(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function listedNames(cms: Cms, token: string): Promise<string[]> {
  const { body } = await rpc(cms, token, 'tools/list');
  const { tools } = body['result'] as { tools: { name: string }[] };
  return tools.map((tool) => tool.name);
}

async function cardNames(cms: Cms): Promise<string[]> {
  const card = (await (await cms.app.request('/.well-known/mcp/server-card.json')).json()) as {
    tools: { name: string }[];
  };
  return card.tools.map((tool) => tool.name);
}

describe('an MCP tool from an enabled plugin', () => {
  it('is listed under the plugin’s prefix with its schemas and annotations', async () => {
    const { cms, token } = await site();
    const { body } = await rpc(cms, await token(['inspect']), 'tools/list');
    const { tools } = body['result'] as { tools: Record<string, unknown>[] };
    const listed = tools.find((tool) => tool['name'] === TOOL_NAME);
    assert.deepEqual(listed, {
      name: TOOL_NAME,
      title: 'Echo back',
      description: 'Says back the text, with who asked.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          username: { type: 'string' },
          client: { type: 'string' },
          clientName: { type: 'string' },
          timezone: { type: 'string' },
          baseUrl: { type: 'string' },
        },
        required: ['text', 'username', 'client', 'timezone', 'baseUrl'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    assert.deepEqual(await cardNames(cms), ['whoami', TOOL_NAME]);
  });

  it('runs for the calling user and client, on the site, in its time zone', async () => {
    const { cms, token } = await site();
    const { status, body } = await rpc(cms, await token(['inspect']), 'tools/call', {
      name: TOOL_NAME,
      arguments: { text: 'hello' },
    });
    assert.equal(status, 200);
    const structured = {
      text: 'hello',
      username: 'ada',
      client: APP,
      clientName: 'Claude Code',
      timezone: 'Europe/London',
      baseUrl: BASE,
    };
    assert.deepEqual(body['result'], {
      content: [
        { type: 'text', text: 'ada said hello.' },
        { type: 'text', text: JSON.stringify(structured) },
      ],
      structuredContent: structured,
      isError: false,
    });
  });

  it('is handed only arguments that fit its input schema', async () => {
    const { cms, token } = await site();
    const { body } = await rpc(cms, await token(['inspect']), 'tools/call', {
      name: TOOL_NAME,
      arguments: { text: 7 },
    });
    assert.deepEqual(body['result'], {
      content: [{ type: 'text', text: 'text must be a string.' }],
      isError: true,
    });
  });
});

describe('the host API version', () => {
  it('goes up for MCP tools, and a plugin built against version 3 still loads', async () => {
    assert.equal(HOST_API_VERSION, 4);
    const contentDir = await box.dir('geekity-mcp-plugin-older-content-');
    const dataDir = await box.dir('geekity-mcp-plugin-older-data-');
    const older = definePlugin({
      name: '@acme/plugin-older',
      version: '1.0.0',
      label: 'Older',
      description: 'Built for version 3.',
      hostApi: 3,
      register(host) {
        host.get('/older', () => new Response('still here'));
      },
    });
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ title: 'A Site', plugins: { '@acme/plugin-older': { enabled: true } } }),
    );
    const cms = await box.open({ contentDir, dataDir, baseUrl: BASE, plugins: [older] });
    assert.equal(await (await cms.app.request('/older')).text(), 'still here');
  });
});

describe('the names of core’s MCP tools', () => {
  it('hold no __, which marks a plugin’s tool, so a plugin’s tool can never take one', async () => {
    const { cms, contentDir } = await site();
    await setPluginEnabled({ contentDir, name: ECHO, enabled: false });
    const core = await cardNames(cms);
    assert.ok(core.length > 0);
    assert.deepEqual(
      core.filter((name) => name.includes('__')),
      [],
    );
  });
});

describe('an MCP tool from a plugin the site disables', () => {
  it('leaves the list and is refused, then comes back on enable, without a restart', async () => {
    const { cms, contentDir, token } = await site();
    const live = await token(['inspect']);
    assert.ok((await listedNames(cms, live)).includes(TOOL_NAME));

    await setPluginEnabled({ contentDir, name: ECHO, enabled: false });
    assert.deepEqual(await listedNames(cms, live), ['whoami']);
    assert.deepEqual(await cardNames(cms), ['whoami']);
    const refused = await rpc(cms, live, 'tools/call', {
      name: TOOL_NAME,
      arguments: { text: 'hello' },
    });
    assert.equal((refused.body['error'] as { code: number }).code, JSON_RPC_ERRORS.invalidParams);

    await setPluginEnabled({ contentDir, name: ECHO, enabled: true });
    assert.deepEqual(await listedNames(cms, live), ['whoami', TOOL_NAME]);
    const called = await rpc(cms, live, 'tools/call', {
      name: TOOL_NAME,
      arguments: { text: 'again' },
    });
    assert.equal((called.body['result'] as { isError: boolean }).isError, false);
  });
});

describe('the guards core puts on a plugin’s MCP tool', () => {
  it('refuses a call without the tool’s scope, naming it in the challenge', async () => {
    const { cms, token } = await site();
    const { status, body } = await rpc(cms, await token(['profile']), 'tools/call', {
      name: TOOL_NAME,
      arguments: { text: 'hello' },
    });
    assert.equal(status, 403);
    assert.equal((body['error'] as { code: number }).code, JSON_RPC_ERRORS.insufficientScope);
  });

  it('records every call to it, the refused ones too', async () => {
    const { cms, dataDir, token } = await site();
    const narrow = await token(['profile']);
    await rpc(cms, narrow, 'tools/call', { name: TOOL_NAME, arguments: { text: 'no' } });
    await rpc(cms, await token(['inspect']), 'tools/call', {
      name: TOOL_NAME,
      arguments: { text: 'yes' },
    });
    const entries = (await readActivityLog(dataDir)).filter((entry) => entry.endpoint === 'mcp');
    assert.deepEqual(
      entries.map((entry) => [entry.action, entry.status, entry.error]).sort(),
      [
        [TOOL_NAME, 200, undefined],
        [TOOL_NAME, 403, 'insufficient_scope'],
      ].sort(),
    );
  });

  it('counts calls to it toward the connection’s limit', async () => {
    const { cms, token } = await site();
    const live = await token(['profile']);
    for (let call = 0; call < MCP_CALLS_PER_WINDOW; call += 1) {
      await rpc(cms, live, 'tools/call', { name: TOOL_NAME, arguments: { text: 'x' } });
    }
    const limited = await rpc(cms, live, 'tools/call', { name: 'whoami', arguments: {} });
    assert.equal((limited.body['error'] as { code: number }).code, JSON_RPC_ERRORS.rateLimited);
  });
});
