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
import type { ToolCall } from './tools.ts';

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
    const registry = createToolRegistry([echo]);
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
    const registry = createToolRegistry([echo]);
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
    const registry = createToolRegistry([echo]);
    const before = ran;
    const outcome = await registry.call('echo', { word: 'hi' }, callAs(['profile', 'repair']));
    assert.deepEqual(outcome, { kind: 'insufficient-scope', scope: 'inspect' });
    assert.equal(ran, before);
  });

  it('answers arguments that do not fit the input schema with a tool error', async () => {
    const registry = createToolRegistry([echo]);
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
    const registry = createToolRegistry([echo]);
    const outcome = await registry.call('echo', undefined, callAs(['inspect']));
    assert.ok(outcome.kind === 'ran' && !outcome.outcome.ok);
  });

  it('knows nothing of a tool it was not given', async () => {
    const registry = createToolRegistry([echo]);
    assert.deepEqual(await registry.call('nothing', {}, callAs(['inspect'])), {
      kind: 'unknown-tool',
    });
  });

  it('refuses two tools with one name, and a name MCP does not allow', () => {
    assert.throws(() => createToolRegistry([echo, echo]), /echo/);
    assert.throws(() => createToolRegistry([{ ...echo, name: 'has space' }]), /has space/);
  });
});
