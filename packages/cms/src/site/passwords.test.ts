import assert from 'node:assert/strict';
import { argon2Sync } from 'node:crypto';
import { describe, it } from 'node:test';

import { hashPassword, verifyPasswordHash } from './passwords.ts';

describe('hashPassword', () => {
  it('encodes the salt and the cost parameters alongside the tag', () => {
    const encoded = hashPassword('correct horse battery');

    assert.match(encoded, /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[^$]+\$[^$]+$/);
  });

  it('salts, so the same password twice is two different hashes', () => {
    assert.notEqual(hashPassword('same password'), hashPassword('same password'));
  });
});

describe('verifyPasswordHash', () => {
  it('accepts the password it was made from', () => {
    assert.equal(verifyPasswordHash(hashPassword('a password'), 'a password'), true);
  });

  it('refuses anything else, including a near miss', () => {
    const encoded = hashPassword('a password');

    assert.equal(verifyPasswordHash(encoded, 'a passwor'), false);
    assert.equal(verifyPasswordHash(encoded, 'a password '), false);
    assert.equal(verifyPasswordHash(encoded, ''), false);
  });

  it('verifies a hash made under different cost parameters', () => {
    // Costs travel with the hash, so raising the defaults later leaves every
    // password already stored verifiable. This one is built straight from
    // node:crypto at costs the defaults do not use.
    const salt = Buffer.from('sixteen bytes!!!', 'utf8');
    const tag = argon2Sync('argon2id', {
      message: Buffer.from('a password', 'utf8'),
      nonce: salt,
      memory: 64,
      passes: 1,
      parallelism: 1,
      tagLength: 32,
    });
    const encoded = `$argon2id$v=19$m=64,t=1,p=1$${salt.toString('base64').replace(/=+$/, '')}$${Buffer.from(tag).toString('base64').replace(/=+$/, '')}`;

    assert.equal(verifyPasswordHash(encoded, 'a password'), true);
    assert.equal(verifyPasswordHash(encoded, 'another password'), false);
  });

  it('fails rather than throws on a hash it cannot read', () => {
    for (const broken of [
      '',
      'not a hash at all',
      '$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$dGFn',
      '$argon2id$v=16$m=19456,t=2,p=1$c2FsdA$dGFn',
      '$argon2id$v=19$m=oops,t=2,p=1$c2FsdA$dGFn',
      '$argon2id$v=19$m=19456,t=2,p=1$$dGFn',
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$',
    ]) {
      assert.equal(verifyPasswordHash(broken, 'a password'), false, broken);
    }
  });
});
