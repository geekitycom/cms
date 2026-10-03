/**
 * Codes and pending consents (TASK-158): unguessable keys, taken once, and
 * gone within minutes.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CODE_LIFETIME_MS, createIndieAuthState } from './grants.ts';
import type { AuthorizationCode } from './grants.ts';

const CODE: AuthorizationCode = {
  clientId: 'https://app.example/',
  redirectUri: 'https://app.example/callback',
  codeChallenge: { method: 'S256', value: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' },
  userId: 1,
  me: 'https://blog.example/',
  scopes: ['profile'],
};

describe('authorization codes', () => {
  it('are taken once', () => {
    const state = createIndieAuthState(() => new Date('2026-10-01T00:00:00Z'));
    const code = state.codes.put(CODE);
    assert.deepEqual(state.codes.take(code), CODE);
    assert.equal(state.codes.take(code), undefined);
  });

  it('expire within ten minutes, as the IndieAuth spec asks', () => {
    assert.ok(CODE_LIFETIME_MS <= 10 * 60 * 1000);
    let now = new Date('2026-10-01T00:00:00Z');
    const state = createIndieAuthState(() => now);
    const code = state.codes.put(CODE);
    now = new Date(now.getTime() + CODE_LIFETIME_MS);
    assert.equal(state.codes.take(code), undefined);
  });

  it('are different every time and too long to guess', () => {
    const state = createIndieAuthState(() => new Date('2026-10-01T00:00:00Z'));
    const first = state.codes.put(CODE);
    const second = state.codes.put(CODE);
    assert.notEqual(first, second);
    assert.ok(first.length >= 43);
  });
});
