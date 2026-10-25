import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { MCP_ACTIVITY, dataPath } from '../files/data-files.ts';
import type { Cms } from '../index.ts';
import type { Scope } from '../indieauth/request.ts';
import { createToken, issueTokens, listTokens } from '../indieauth/tokens.ts';
import { findUser } from '../site/users.ts';
import {
  ACTIVITY_LOG_MAX_AGE_MS,
  MCP_ACTIVITY_LIMIT,
  readActivityLog,
} from '../web/indieauth-activity-log.ts';
import type { ActivityEntry } from '../web/indieauth-activity-log.ts';
import { MCP_CALL_WINDOW_SECONDS, MCP_CALLS_PER_WINDOW } from './endpoint.ts';
import { JSON_RPC_ERRORS } from './protocol.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const MCP = '/_geekity/mcp';
const APP = 'https://claude.example/client.json';
const START = Date.parse('2026-10-25T12:00:00.000Z');

interface Site {
  cms: Cms;
  dataDir: string;
  agent: Browser;
  advance: (ms: number) => void;
  token: (scopes: readonly Scope[]) => Promise<string>;
}

async function site(): Promise<Site> {
  const contentDir = await box.dir('geekity-mcp-audit-content-');
  const dataDir = await box.dir('geekity-mcp-audit-data-');
  let now = START;
  const cms = await box.open({ contentDir, dataDir, baseUrl: BASE, now: () => new Date(now) });
  const agent = await signedIn(cms);
  return {
    cms,
    dataDir,
    agent,
    advance(ms) {
      now += ms;
    },
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
        new Date(now),
      );
      return issued.accessToken;
    },
  };
}

let nextId = 1;

async function callTool(
  cms: Cms,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await cms.app.request(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function mcpEntries(dataDir: string): Promise<ActivityEntry[]> {
  return (await readActivityLog(dataDir)).filter((entry) => entry.endpoint === 'mcp');
}

describe('the record of MCP tool calls', () => {
  it('records a call with its time, user, client, connection, tool and outcome', async () => {
    const { cms, dataDir, token } = await site();
    const live = await token(['profile']);
    const { status } = await callTool(cms, live, 'whoami');
    assert.equal(status, 200);

    const [entry] = await mcpEntries(dataDir);
    assert.ok(entry !== undefined, 'the call was recorded');
    const [connection] = listTokens(dataDir);
    assert.deepEqual(
      {
        at: entry.at,
        user: entry.user,
        clientId: entry.clientId,
        connection: entry.connection,
        action: entry.action,
        status: entry.status,
        error: entry.error,
      },
      {
        at: new Date(START).toISOString(),
        user: 'ada',
        clientId: APP,
        connection: connection?.id,
        action: 'whoami',
        status: 200,
        error: undefined,
      },
    );
  });

  it('keeps the arguments with secret fields replaced and long values cut, and records a tool error', async () => {
    const { cms, dataDir, token } = await site();
    const live = await token(['profile']);
    const answered = await callTool(cms, live, 'whoami', {
      access_token: 'the-secret-value',
      note: 'x'.repeat(500),
    });
    assert.equal((answered.body['result'] as { isError: boolean }).isError, true);

    const [entry] = await mcpEntries(dataDir);
    assert.ok(entry !== undefined);
    assert.equal(entry.error, 'tool_error');
    assert.match(entry.errorDescription ?? '', /access_token is not an argument/);
    assert.deepEqual(entry.carried[0], { name: 'access_token', redacted: true });
    const note = entry.carried[1];
    assert.ok(note !== undefined && 'value' in note);
    assert.equal(note.value, `${'x'.repeat(100)}…`);
    const file = await readFile(dataPath(dataDir, MCP_ACTIVITY), 'utf8');
    assert.ok(!file.includes('the-secret-value'), 'the secret is in no file');
  });

  it('records a call refused for scope and a call to a tool that does not exist', async () => {
    const { cms, dataDir, token } = await site();
    const live = await token(['inspect']);
    assert.equal((await callTool(cms, live, 'whoami')).status, 403);
    await callTool(cms, live, 'no-such-tool');

    const entries = await mcpEntries(dataDir);
    assert.deepEqual(
      entries.map((entry) => [entry.action, entry.status, entry.error]),
      [
        ['no-such-tool', 200, 'unknown_tool'],
        ['whoami', 403, 'insufficient_scope'],
      ],
    );
  });

  it('names a token created by hand, which has no client URL', async () => {
    const { cms, dataDir } = await site();
    const ada = findUser(dataDir, 'ada');
    assert.ok(ada !== undefined);
    const { accessToken } = await createToken(
      dataDir,
      {
        userId: ada.id,
        me: `${BASE}/`,
        name: 'Laptop agent',
        scopes: ['profile'],
        resource: `${BASE}${MCP}`,
        lifetimeMs: 86_400_000,
      },
      new Date(START),
    );
    await callTool(cms, accessToken, 'whoami');
    const [entry] = await mcpEntries(dataDir);
    assert.equal(entry?.tokenName, 'Laptop agent');
    assert.equal(entry?.clientId, undefined);
  });

  it('is kept in a file of its own, private to the site’s user, bounded in count', async () => {
    const { cms, dataDir, token, advance } = await site();
    const live = await token(['profile']);
    for (let index = 0; index < MCP_ACTIVITY_LIMIT + 2; index += 1) {
      if (index > 0 && index % MCP_CALLS_PER_WINDOW === 0) {
        advance(MCP_CALL_WINDOW_SECONDS * 1000);
      }
      await callTool(cms, live, 'whoami');
    }
    const entries = await mcpEntries(dataDir);
    assert.equal(entries.length, MCP_ACTIVITY_LIMIT);
    assert.equal(entries.filter((entry) => entry.error !== undefined).length, 0);
    const { mode } = await stat(dataPath(dataDir, MCP_ACTIVITY));
    assert.equal(mode & 0o777, 0o600);
  });

  it('drops calls older than the documented fourteen days', async () => {
    const { cms, dataDir, token, advance } = await site();
    assert.equal(ACTIVITY_LOG_MAX_AGE_MS, 14 * 24 * 60 * 60 * 1000);
    const live = await token(['profile']);
    await callTool(cms, live, 'whoami');
    advance(ACTIVITY_LOG_MAX_AGE_MS + 1000);
    const later = await token(['profile']);
    await callTool(cms, later, 'no-such-tool');

    const entries = await mcpEntries(dataDir);
    assert.deepEqual(
      entries.map((entry) => entry.action),
      ['no-such-tool'],
    );
  });
});

describe('the per-token limit', () => {
  it('answers a call over the limit with an MCP error naming the wait, and lets calls in again after it', async () => {
    const { cms, dataDir, token, advance } = await site();
    const live = await token(['profile']);
    for (let index = 0; index < MCP_CALLS_PER_WINDOW; index += 1) {
      const { body } = await callTool(cms, live, 'whoami');
      assert.equal(body['error'], undefined, `call ${String(index + 1)} is allowed`);
    }
    advance(15_000);

    const refused = await callTool(cms, live, 'whoami');
    assert.equal(refused.status, 200);
    const error = refused.body['error'] as { code: number; message: string; data: unknown };
    assert.equal(error.code, JSON_RPC_ERRORS.rateLimited);
    assert.deepEqual(error.data, { retryAfter: MCP_CALL_WINDOW_SECONDS - 15 });
    assert.match(error.message, /Try again in 45 seconds/);

    const again = await callTool(cms, live, 'whoami');
    assert.ok(again.body['error'] !== undefined, 'still refused inside the window');

    const other = await token(['profile']);
    assert.equal(
      (await callTool(cms, other, 'whoami')).body['error'],
      undefined,
      'another token has its own limit',
    );

    advance(45_000);
    assert.equal(
      (await callTool(cms, live, 'whoami')).body['error'],
      undefined,
      'allowed in the next window',
    );

    const refusals = (await mcpEntries(dataDir)).filter((entry) => entry.error === 'rate_limited');
    assert.equal(refusals.length, 1, 'a run of refusals is recorded once');
    assert.match(refusals[0]?.errorDescription ?? '', /45 seconds/);
  });
});

describe('where the owner reads it', () => {
  it('lists MCP calls on App activity with the IndieAuth and Micropub requests, and shows one in full', async () => {
    const { cms, dataDir, agent, token } = await site();
    const live = await token(['profile']);
    await callTool(cms, live, 'whoami', { verbose: true });
    await cms.app.request('/_geekity/micropub?q=config', {
      headers: { authorization: 'Bearer not-a-token' },
    });
    await readActivityLog(dataDir);

    const html = await (await agent.get('/admin/users/activity')).text();
    assert.match(html, />MCP</);
    assert.match(html, />whoami</);
    assert.match(html, />Micropub</);

    const [entry] = await mcpEntries(dataDir);
    assert.ok(entry !== undefined);
    const full = await (await agent.get(`/admin/users/activity/${entry.id}`)).text();
    assert.match(full, /verbose/);
    assert.match(full, /tool_error/);
    assert.match(full, /Claude|claude\.example/);
  });

  it('shows each connection’s recent activity on Connected apps, MCP calls among it', async () => {
    const { cms, dataDir, agent, token } = await site();
    const live = await token(['profile']);
    await callTool(cms, live, 'whoami');
    await callTool(cms, live, 'no-such-tool');
    await readActivityLog(dataDir);

    const html = await (await agent.get('/admin/users/apps')).text();
    const entries = await mcpEntries(dataDir);
    assert.equal(entries.length, 2);
    for (const entry of entries) {
      assert.ok(html.includes(`/admin/users/activity/${entry.id}`), `links ${entry.action}`);
    }
    assert.match(html, /MCP whoami/);
    assert.match(html, /MCP no-such-tool/);
  });
});
