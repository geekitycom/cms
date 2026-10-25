/**
 * The tool registry: one place that lists tools, checks the scope a tool
 * declares before it runs, and checks the arguments against its input schema.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Scope } from '../indieauth/request.ts';
import type { StoredToken } from '../indieauth/tokens.ts';
import type { User } from '../site/users.ts';
import { createToolRegistry, defineTool, listedTool } from './tools.ts';
import type { McpTool, ToolCall, ToolCallRecord, ToolGuards } from './tools.ts';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function callAs(scopes: readonly Scope[]): ToolCall {
  const token: StoredToken = {
    kind: 'created',
    id: 'id',
    userId: 1,
    me: 'https://blog.example/',
    name: 'test',
    scopes,
    issuedAt: '2026-10-25T00:00:00Z',
    accessTokenHash: 'hash',
    expiresAt: '2026-11-25T00:00:00Z',
  };
  return { user: { id: 1, username: 'ada' } as User, token, signal: new AbortController().signal };
}

let ran = 0;

/** Guards that let every call through and keep what the registry records. */
function watching(refuse?: { retryAfter: number; first: boolean }): {
  guards: ToolGuards;
  records: ToolCallRecord[];
  keys: string[];
} {
  const records: ToolCallRecord[] = [];
  const keys: string[] = [];
  return {
    records,
    keys,
    guards: {
      limit: {
        take: (key) => {
          keys.push(key);
          return refuse === undefined ? { kind: 'allowed' } : { kind: 'refused', ...refuse };
        },
      },
      record: (record) => records.push(record),
    },
  };
}

function registryOf(tools: readonly McpTool[]) {
  return createToolRegistry(tools, watching().guards);
}

const echo = defineTool({
  name: 'echo',
  title: 'Echo',
  description: 'Says back what it is given.',
  scope: 'inspect',
  annotations: READ_ONLY,
  inputSchema: {
    type: 'object',
    properties: {
      word: { type: 'string', description: 'What to say.' },
      times: { type: 'integer', minimum: 1, maximum: 3 },
      tone: { type: 'string', enum: ['plain', 'loud'] },
    },
    required: ['word'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { said: { type: 'array', items: { type: 'string' } } },
    required: ['said'],
  },
  run: ({ word, times, tone }) => {
    ran += 1;
    const said = Array.from({ length: times ?? 1 }, () =>
      tone === 'loud' ? word.toUpperCase() : word,
    );
    return Promise.resolve({ ok: true, summary: said.join(' '), structured: { said } });
  },
});

describe('the tool registry', () => {
  it('lists each tool with its schemas, annotations and title', () => {
    const registry = registryOf([echo]);
    assert.deepEqual(registry.list().map(listedTool), [
      {
        name: 'echo',
        title: 'Echo',
        description: 'Says back what it is given.',
        inputSchema: echo.inputSchema,
        outputSchema: echo.outputSchema,
        annotations: READ_ONLY,
      },
    ]);
  });

  it('runs a tool for a token holding its scope', async () => {
    const registry = registryOf([echo]);
    const outcome = await registry.call(
      'echo',
      { word: 'hi', times: 2, tone: 'loud' },
      callAs(['inspect']),
    );
    assert.deepEqual(outcome, {
      kind: 'ran',
      outcome: { ok: true, summary: 'HI HI', structured: { said: ['HI', 'HI'] } },
    });
  });

  it('refuses a token without the scope before the tool runs', async () => {
    const registry = registryOf([echo]);
    const before = ran;
    const outcome = await registry.call('echo', { word: 'hi' }, callAs(['profile', 'repair']));
    assert.deepEqual(outcome, { kind: 'insufficient-scope', scope: 'inspect' });
    assert.equal(ran, before);
  });

  it('answers arguments that do not fit the input schema with a tool error', async () => {
    const registry = registryOf([echo]);
    const before = ran;
    const outcome = await registry.call(
      'echo',
      { times: 9, tone: 'quiet', extra: true },
      callAs(['inspect']),
    );
    assert.equal(ran, before);
    assert.equal(outcome.kind, 'ran');
    assert.ok(outcome.kind === 'ran' && !outcome.outcome.ok);
    const message = outcome.kind === 'ran' && !outcome.outcome.ok ? outcome.outcome.message : '';
    assert.match(message, /word is required/);
    assert.match(message, /times must be at most 3/);
    assert.match(message, /tone must be one of plain, loud/);
    assert.match(message, /extra is not an argument/);
  });

  it('treats missing arguments as an empty object', async () => {
    const registry = registryOf([echo]);
    const outcome = await registry.call('echo', undefined, callAs(['inspect']));
    assert.ok(outcome.kind === 'ran' && !outcome.outcome.ok);
  });

  it('knows nothing of a tool it was not given', async () => {
    const registry = registryOf([echo]);
    assert.deepEqual(await registry.call('nothing', {}, callAs(['inspect'])), {
      kind: 'unknown-tool',
    });
  });

  it('refuses two tools with one name, and a name MCP does not allow', () => {
    assert.throws(() => registryOf([echo, echo]), /echo/);
    assert.throws(() => registryOf([{ ...echo, name: 'has space' }]), /has space/);
  });
});

const boom = defineTool({
  ...echo,
  name: 'boom',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run: () => Promise.reject(new Error('the disk is on fire')),
});

describe('what every call passes, whatever the tool', () => {
  it('records a call that ran, with its tool, arguments, caller and outcome', async () => {
    const { guards, records } = watching();
    const call = callAs(['inspect']);
    await createToolRegistry([echo], guards).call('echo', { word: 'hi' }, call);
    assert.deepEqual(records, [
      {
        tool: 'echo',
        args: { word: 'hi' },
        call,
        outcome: {
          kind: 'ran',
          outcome: { ok: true, summary: 'hi', structured: { said: ['hi'] } },
        },
      },
    ]);
  });

  it('records a refusal for scope, an unknown tool and a tool error as they were answered', async () => {
    const { guards, records } = watching();
    const registry = createToolRegistry([echo], guards);
    await registry.call('echo', { word: 'hi' }, callAs(['profile']));
    await registry.call('nothing', {}, callAs(['inspect']));
    await registry.call('echo', { times: 9 }, callAs(['inspect']));
    assert.deepEqual(
      records.map((record) => record.outcome.kind),
      ['insufficient-scope', 'unknown-tool', 'ran'],
    );
    const third = records[2]?.outcome;
    assert.ok(third?.kind === 'ran' && !third.outcome.ok);
  });

  it('answers a tool that throws with a tool error, and records why it failed', async () => {
    const { guards, records } = watching();
    const outcome = await createToolRegistry([boom], guards).call('boom', {}, callAs(['inspect']));
    assert.ok(outcome.kind === 'ran' && !outcome.outcome.ok);
    const message = outcome.kind === 'ran' && !outcome.outcome.ok ? outcome.outcome.message : '';
    assert.match(message, /boom failed/);
    assert.doesNotMatch(message, /disk is on fire/);
    assert.deepEqual(
      records.map((record) => record.outcome),
      [{ kind: 'crashed', reason: 'the disk is on fire' }],
    );
  });

  it('counts each call against its token, before anything else is looked at', async () => {
    const { guards, keys } = watching();
    const registry = createToolRegistry([echo], guards);
    await registry.call('nothing', {}, callAs(['inspect']));
    await registry.call('echo', { word: 'hi' }, callAs(['profile']));
    assert.deepEqual(keys, ['id', 'id']);
  });

  it('refuses a call over the limit without running it, with how long to wait', async () => {
    const { guards, records } = watching({ retryAfter: 42, first: true });
    const before = ran;
    const outcome = await createToolRegistry([echo], guards).call(
      'echo',
      { word: 'hi' },
      callAs(['inspect']),
    );
    assert.deepEqual(outcome, { kind: 'rate-limited', retryAfter: 42 });
    assert.equal(ran, before);
    assert.deepEqual(
      records.map((record) => record.outcome),
      [{ kind: 'rate-limited', retryAfter: 42 }],
    );
  });

  it('records only the first refusal in a window, so a looping client cannot flood the record', async () => {
    const { guards, records } = watching({ retryAfter: 41, first: false });
    const outcome = await createToolRegistry([echo], guards).call(
      'echo',
      { word: 'hi' },
      callAs(['inspect']),
    );
    assert.deepEqual(outcome, { kind: 'rate-limited', retryAfter: 41 });
    assert.deepEqual(records, []);
  });
});
