import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import type { AuthorizationCode } from '../indieauth/grants.ts';
import type { Scope } from '../indieauth/request.ts';
import { createToken, issueTokens } from '../indieauth/tokens.ts';
import { UPLOAD_ENVELOPE_BYTES } from '../media/uploads.ts';
import { base64Length } from './authoring/upload.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const MCP = '/_geekity/mcp';
const MCP_RESOURCE = `${BASE}${MCP}`;
const MCP_METADATA_PATH = '/.well-known/oauth-protected-resource/_geekity/mcp';
const APP = 'https://claude.example/client.json';

async function site(config: GeekityConfig = {}): Promise<Cms> {
  const contentDir = await box.dir('geekity-mcp-content-');
  const dataDir = await box.dir('geekity-mcp-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', author: 'ada' }),
  );
  writeUsers(dataDir, [{ username: 'ada' }]);
  return await box.open({ contentDir, dataDir, baseUrl: BASE, ...config });
}

async function tokenFor(
  cms: Cms,
  scopes: readonly Scope[],
  resource: string | null = MCP_RESOURCE,
): Promise<string> {
  const grant: AuthorizationCode = {
    clientId: APP,
    clientName: 'Claude Code',
    redirectUri: 'http://localhost:4567/callback',
    codeChallenge: { method: 'S256', value: 'unused' },
    userId: 1,
    me: `${BASE}/`,
    scopes,
    ...(resource === null ? {} : { resource }),
  };
  return (await issueTokens(cms.config.dataDir, grant, new Date())).accessToken;
}

interface Exchange {
  readonly response: Response;
  readonly body: Record<string, unknown> | undefined;
}

let nextId = 1;

async function rpc(
  cms: Cms,
  token: string | undefined,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<Exchange> {
  const response = await cms.app.request(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const text = await response.text();
  return {
    response,
    body: text === '' ? undefined : (JSON.parse(text) as Record<string, unknown>),
  };
}

function result(exchange: Exchange): Record<string, unknown> {
  assert.equal(exchange.response.status, 200);
  assert.equal(exchange.body?.['error'], undefined, JSON.stringify(exchange.body));
  return exchange.body?.['result'] as Record<string, unknown>;
}

describe('an MCP client with a token bound to the endpoint', () => {
  it('initializes, lists the tools and calls whoami', async () => {
    const cms = await site();
    const token = await tokenFor(cms, ['profile', 'inspect']);

    const init = result(
      await rpc(cms, token, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    );
    assert.equal(init['protocolVersion'], '2025-06-18');
    assert.deepEqual(init['capabilities'], { tools: { listChanged: false } });
    assert.equal((init['serverInfo'] as { name: string }).name, 'geekity');

    const initialized = await cms.app.request(MCP, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.equal(initialized.status, 202);
    assert.equal(await initialized.text(), '');

    const listed = result(await rpc(cms, token, 'tools/list'));
    const tools = listed['tools'] as Array<Record<string, unknown>>;
    const whoami = tools.find((tool) => tool['name'] === 'whoami');
    assert.ok(whoami);
    assert.equal((whoami['inputSchema'] as { type: string }).type, 'object');
    assert.equal((whoami['outputSchema'] as { type: string }).type, 'object');
    assert.deepEqual(whoami['annotations'], {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    const called = result(await rpc(cms, token, 'tools/call', { name: 'whoami', arguments: {} }));
    assert.equal(called['isError'], false);
    assert.deepEqual(called['structuredContent'], {
      me: `${BASE}/`,
      username: 'ada',
      client: APP,
      clientName: 'Claude Code',
      scopes: ['profile', 'inspect'],
    });
    const [summary] = called['content'] as Array<{ type: string; text: string }>;
    assert.equal(summary?.type, 'text');
    assert.match(summary?.text ?? '', /ada/);
  });

  it('names a created token by its name, since it has no client', async () => {
    const cms = await site();
    const { accessToken } = await createToken(
      cms.config.dataDir,
      {
        userId: 1,
        me: `${BASE}/`,
        name: 'laptop',
        scopes: ['profile'],
        resource: MCP_RESOURCE,
        lifetimeMs: 60_000,
      },
      new Date(),
    );
    const called = result(
      await rpc(cms, accessToken, 'tools/call', { name: 'whoami', arguments: {} }),
    );
    const structured = called['structuredContent'] as Record<string, unknown>;
    assert.equal(structured['client'], 'laptop');
    assert.equal(structured['clientName'], undefined);
  });

  it('answers ping, and an unknown method with a JSON-RPC error', async () => {
    const cms = await site();
    const token = await tokenFor(cms, ['profile']);
    assert.deepEqual(result(await rpc(cms, token, 'ping')), {});
    const unknown = await rpc(cms, token, 'resources/list');
    assert.equal((unknown.body?.['error'] as { code: number }).code, -32601);
  });

  it('answers a call to a tool nobody registered with an invalid params error', async () => {
    const cms = await site();
    const token = await tokenFor(cms, ['profile']);
    const called = await rpc(cms, token, 'tools/call', { name: 'nothing', arguments: {} });
    assert.equal((called.body?.['error'] as { code: number }).code, -32602);
  });

  it('turns away a body that is not one JSON-RPC message', async () => {
    const cms = await site();
    const token = await tokenFor(cms, ['profile']);
    const response = await cms.app.request(MCP, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: '[{"jsonrpc":"2.0","id":1,"method":"ping"}]',
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { code: number } };
    assert.equal(body.error.code, -32600);
  });

  it('offers no stream on GET and no session to end on DELETE', async () => {
    const cms = await site();
    const token = await tokenFor(cms, ['profile']);
    for (const method of ['GET', 'DELETE']) {
      const response = await cms.app.request(MCP, {
        method,
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 405, method);
    }
  });

  it('refuses a request from a web page on another origin', async () => {
    const cms = await site();
    const token = await tokenFor(cms, ['profile']);
    const refused = await rpc(cms, token, 'ping', {}, { origin: 'https://evil.example' });
    assert.equal(refused.response.status, 403);
    const own = await rpc(cms, token, 'ping', {}, { origin: BASE });
    assert.equal(own.response.status, 200);
  });

  it('refuses a protocol version it does not speak', async () => {
    const cms = await site();
    const token = await tokenFor(cms, ['profile']);
    const refused = await rpc(cms, token, 'ping', {}, { 'mcp-protocol-version': '1999-01-01' });
    assert.equal(refused.response.status, 400);
  });

  it('answers initialize with its own newest version when the client asks for an unknown one', async () => {
    const cms = await site();
    const token = await tokenFor(cms, ['profile']);
    const init = result(
      await rpc(cms, token, 'initialize', {
        protocolVersion: '1999-01-01',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    );
    assert.equal(init['protocolVersion'], '2025-11-25');
  });
});

describe('a client the MCP endpoint refuses', () => {
  const challenged = (response: Response): void => {
    assert.equal(response.status, 401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    assert.match(challenge, /^Bearer /);
    assert.ok(challenge.includes(`resource_metadata="${BASE}${MCP_METADATA_PATH}"`), challenge);
  };

  it('holds no token', async () => {
    const cms = await site();
    challenged((await rpc(cms, undefined, 'tools/list')).response);
  });

  it('holds a token bound to no resource', async () => {
    const cms = await site();
    const token = await tokenFor(cms, ['profile'], null);
    challenged((await rpc(cms, token, 'tools/list')).response);
  });

  it('holds a Micropub token, bound to the site', async () => {
    const cms = await site();
    const token = await tokenFor(cms, ['profile', 'create'], BASE);
    challenged((await rpc(cms, token, 'tools/list')).response);
  });

  it('holds a token bound to some other resource on the site', async () => {
    const cms = await site();
    const token = await tokenFor(cms, ['profile'], `${BASE}/elsewhere`);
    challenged((await rpc(cms, token, 'tools/list')).response);
  });

  it('is pointed at a metadata document that names the MCP resource', async () => {
    const cms = await site();
    const response = await cms.app.request(MCP_METADATA_PATH);
    assert.equal(response.status, 200);
    const metadata = (await response.json()) as Record<string, unknown>;
    assert.equal(metadata['resource'], MCP_RESOURCE);
    assert.deepEqual(metadata['authorization_servers'], [BASE]);
    assert.deepEqual(metadata['bearer_methods_supported'], ['header']);
    const scopes = metadata['scopes_supported'] as string[];
    for (const scope of ['profile', 'inspect', 'repair', 'publish']) {
      assert.ok(scopes.includes(scope), scope);
    }
    assert.ok(!scopes.includes('delete'));
  });

  it('calls a tool its token lacks the scope for, and is told which scope', async () => {
    const cms = await site();
    const token = await tokenFor(cms, ['inspect']);
    const called = await rpc(cms, token, 'tools/call', { name: 'whoami', arguments: {} });
    assert.equal(called.response.status, 403);
    const challenge = called.response.headers.get('www-authenticate') ?? '';
    assert.match(challenge, /error="insufficient_scope"/);
    assert.match(challenge, /scope="inspect profile"/);
    assert.ok(challenge.includes(`resource_metadata="${BASE}${MCP_METADATA_PATH}"`));
    const error = called.body?.['error'] as { code: number; message: string; data: unknown };
    assert.match(error.message, /profile/);
    assert.deepEqual(error.data, { scope: 'profile' });
  });
});

describe('a request body over the limit', () => {
  const UPLOAD_LIMIT = 3000;
  const BODY_LIMIT = base64Length(UPLOAD_LIMIT) + UPLOAD_ENVELOPE_BYTES;
  const CHUNK = 1024;
  const smallUploads = { uploadMaxBytes: UPLOAD_LIMIT, uploadMediaMaxBytes: UPLOAD_LIMIT };

  function endless(): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += CHUNK;
          controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
        },
      },
      { highWaterMark: 0 },
    );
    return { stream, pulled: () => pulled };
  }

  function post(
    token: string | undefined,
    body: ReadableStream<Uint8Array>,
    headers: Record<string, string> = {},
  ): Request {
    return new Request(`${BASE}${MCP}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...headers,
      },
      body,
      duplex: 'half',
    } as RequestInit);
  }

  it('is refused with 413 by its declared length, without being read', async () => {
    const cms = await site(smallUploads);
    const token = await tokenFor(cms, ['profile']);
    const body = endless();
    const response = await cms.app.request(
      post(token, body.stream, { 'content-length': String(BODY_LIMIT + 1) }),
    );
    assert.equal(response.status, 413);
    const answer = (await response.json()) as { error: { code: number; message: string } };
    assert.equal(answer.error.code, -32600);
    assert.match(answer.error.message, new RegExp(String(BODY_LIMIT)));
    assert.equal(body.pulled(), 0);
  });

  it('is cut off at the limit while it streams in, when it declares no length', async () => {
    const cms = await site(smallUploads);
    const token = await tokenFor(cms, ['profile']);
    const body = endless();
    const response = await cms.app.request(post(token, body.stream));
    assert.equal(response.status, 413);
    assert.ok(body.pulled() <= BODY_LIMIT + CHUNK, String(body.pulled()));
  });

  it('is refused for a client with no token as before, and never read', async () => {
    const cms = await site(smallUploads);
    const body = endless();
    const response = await cms.app.request(post(undefined, body.stream));
    assert.equal(response.status, 401);
    assert.equal(body.pulled(), 0);
  });

  it('lets a body at the limit through', async () => {
    const cms = await site(smallUploads);
    const token = await tokenFor(cms, ['profile']);
    const message = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const padded = message + ' '.repeat(BODY_LIMIT - message.length);
    const response = await cms.app.request(MCP, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: padded,
    });
    assert.equal(response.status, 200);
  });
});

describe('the MCP endpoint in maintenance mode', () => {
  it('answers 503, like the authorization and token endpoints', async () => {
    const cms = await site({ maintenance: true });
    const token = await tokenFor(cms, ['profile']);
    const response = await rpc(cms, token, 'tools/list');
    assert.equal(response.response.status, 503);
  });
});

describe('finding the MCP endpoint', () => {
  it('serves a server card naming the endpoint, its transport and its tools', async () => {
    const cms = await site();
    const response = await cms.app.request('/.well-known/mcp/server-card.json');
    assert.equal(response.status, 200);
    const card = (await response.json()) as Record<string, unknown>;
    assert.equal((card['serverInfo'] as { name: string }).name, 'geekity');
    assert.equal((card['serverInfo'] as { title: string }).title, 'A Site');
    assert.deepEqual(card['transport'], { type: 'streamable-http', endpoint: MCP_RESOURCE });
    assert.deepEqual(card['authentication'], {
      required: true,
      schemes: ['oauth2'],
      resourceMetadata: `${BASE}${MCP_METADATA_PATH}`,
    });
    const tools = card['tools'] as Array<{ name: string }>;
    assert.ok(tools.some((tool) => tool.name === 'whoami'));
  });

  it('points at the server card from the home page', async () => {
    const cms = await site();
    const response = await cms.app.request('/');
    assert.equal(response.status, 200);
    const links = response.headers.get('link') ?? '';
    assert.ok(links.includes('</.well-known/mcp/server-card.json>; rel="mcp"'), links);
    assert.ok(links.includes('</llms.txt>; rel="describedby"'), links);
  });

  it('names the endpoint in the generated llms.txt', async () => {
    const cms = await site();
    const response = await cms.app.request('/llms.txt');
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(text.includes(MCP_RESOURCE), text);
    assert.ok(text.includes(`${BASE}/.well-known/mcp/server-card.json`), text);
  });
});
