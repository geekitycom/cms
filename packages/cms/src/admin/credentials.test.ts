import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  credentialProblem,
  MINIMUM_PASSWORD_LENGTH,
  passwordProblem,
  usernameProblem,
} from './credentials.ts';

describe('usernameProblem', () => {
  it('is undefined for a name of letters, digits, dots, dashes and underscores', () => {
    for (const name of ['ada', 'Ada', 'ada.lovelace', 'ada-lovelace', 'ada_1815', 'a', '1']) {
      assert.equal(usernameProblem(name), undefined, name);
    }
  });

  it('names the rule when the username is empty', () => {
    assert.match(usernameProblem('') ?? '', /1 to 64/);
  });

  it('refuses a name with a space or punctuation to escape', () => {
    for (const name of ['ada lovelace', 'ada@example.com', '<ada>', 'ada/lovelace', 'ada\n']) {
      assert.notEqual(usernameProblem(name), undefined, name);
    }
  });

  it('refuses a name longer than 64 characters', () => {
    assert.equal(usernameProblem('a'.repeat(64)), undefined);
    assert.notEqual(usernameProblem('a'.repeat(65)), undefined);
  });
});

describe('passwordProblem', () => {
  it('is undefined once the password is long enough', () => {
    assert.equal(passwordProblem('a'.repeat(MINIMUM_PASSWORD_LENGTH)), undefined);
  });

  it('names the minimum when the password is short', () => {
    const problem = passwordProblem('a'.repeat(MINIMUM_PASSWORD_LENGTH - 1)) ?? '';
    assert.match(problem, new RegExp(String(MINIMUM_PASSWORD_LENGTH)));
  });

  it('refuses an empty password', () => {
    assert.notEqual(passwordProblem(''), undefined);
  });
});

describe('credentialProblem', () => {
  it('is undefined when both are acceptable', () => {
    assert.equal(credentialProblem('ada', 'correct horse battery'), undefined);
  });

  it('reports the username first, so the first fix is the first message', () => {
    assert.equal(credentialProblem('ada lovelace', 'short'), usernameProblem('ada lovelace'));
  });

  it('reports the password when the username is fine', () => {
    assert.equal(credentialProblem('ada', 'short'), passwordProblem('short'));
  });
});
