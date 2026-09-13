import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  credentialProblem,
  emailProblem,
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

  it('refuses a name that would not survive as a URL segment (TASK-67 AC #4)', () => {
    // decision-14 puts every user at `/author/{username}/`, and a segment of
    // nothing but dots is not a segment: `.` and `..` are the current and the
    // parent directory to every URL resolver there is.
    for (const name of ['.', '..', '...']) {
      assert.match(usernameProblem(name) ?? '', /author/, name);
    }
    assert.equal(usernameProblem('ada.lovelace'), undefined, 'a dot inside a name is fine');
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

describe('emailProblem', () => {
  it('is undefined for an empty address, because an email is optional', () => {
    assert.equal(emailProblem(''), undefined);
    assert.equal(emailProblem('   '), undefined);
  });

  it('is undefined for something that looks like an address', () => {
    for (const address of ['ada@example.com', 'ada+resets@mail.example.co.uk', 'A@b.co']) {
      assert.equal(emailProblem(address), undefined, address);
    }
  });

  it('names the rule for something that is not one', () => {
    for (const address of ['ada', 'ada@example', 'ada example.com', 'ada@ example.com']) {
      assert.match(emailProblem(address) ?? '', /email address/, address);
    }
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
