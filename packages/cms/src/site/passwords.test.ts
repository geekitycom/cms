import assert from 'node:assert/strict';
import { argon2Sync } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  ARGON2_PARAMETERS,
  hashPassword,
  passwordHashIsCurrent,
  verifyPasswordHash,
} from './passwords.ts';

function encodedAt(password: string, costs: { memory: number; passes: number }): string {
  const salt = Buffer.from('sixteen bytes!!!', 'utf8');
  const tag = argon2Sync('argon2id', {
    message: Buffer.from(password, 'utf8'),
    nonce: salt,
    memory: costs.memory,
    passes: costs.passes,
    parallelism: 1,
    tagLength: 32,
  });
  const unpadded = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${String(costs.memory)},t=${String(costs.passes)},p=1$${unpadded(salt)}$${unpadded(tag)}`;
}

const COMPOSED = 'caf\u00e9 cr\u00e8me';
const DECOMPOSED = 'cafe\u0301 cre\u0300me';

describe('hashPassword', () => {
  it('encodes the salt and the cost parameters alongside the tag', async () => {
    const encoded = await hashPassword('correct horse battery');

    assert.match(encoded, /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[^$]+\$[^$]+$/);
  });

  it('salts, so the same password twice is two different hashes', async () => {
    assert.notEqual(await hashPassword('same password'), await hashPassword('same password'));
  });
});

describe('verifyPasswordHash', () => {
  it('accepts the password it was made from', async () => {
    assert.equal(await verifyPasswordHash(await hashPassword('a password'), 'a password'), true);
  });

  it('refuses anything else, including a near miss', async () => {
    const encoded = await hashPassword('a password');

    assert.equal(await verifyPasswordHash(encoded, 'a passwor'), false);
    assert.equal(await verifyPasswordHash(encoded, 'a password '), false);
    assert.equal(await verifyPasswordHash(encoded, ''), false);
  });

  it('verifies a hash made under different cost parameters', async () => {
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

    assert.equal(await verifyPasswordHash(encoded, 'a password'), true);
    assert.equal(await verifyPasswordHash(encoded, 'another password'), false);
  });

  it('fails rather than throws on a hash it cannot read', async () => {
    for (const broken of [
      '',
      'not a hash at all',
      '$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$dGFn',
      '$argon2id$v=16$m=19456,t=2,p=1$c2FsdA$dGFn',
      '$argon2id$v=19$m=oops,t=2,p=1$c2FsdA$dGFn',
      '$argon2id$v=19$m=19456,t=2,p=1$$dGFn',
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$',
    ]) {
      assert.equal(await verifyPasswordHash(broken, 'a password'), false, broken);
    }
  });

  it('refuses, without working through it, a hash whose costs are far above the current ones', async () => {
    const encoded = `$argon2id$v=19$m=${String(ARGON2_PARAMETERS.memory * 1024)},t=2,p=1$c2l4dGVlbiBieXRlcyEhIQ$${'A'.repeat(43)}`;
    const started = performance.now();

    assert.equal(await verifyPasswordHash(encoded, 'a password'), false);
    assert.ok(performance.now() - started < 1000, 'the hash was refused before it was worked');
    assert.equal(
      await verifyPasswordHash(encodedAt('a password', { memory: 64, passes: 100 }), 'a password'),
      false,
    );
  });

  it('accepts the same password typed in another Unicode normalisation form', async () => {
    assert.notEqual(COMPOSED, DECOMPOSED);
    assert.equal(await verifyPasswordHash(await hashPassword(COMPOSED), DECOMPOSED), true);
    assert.equal(await verifyPasswordHash(await hashPassword(DECOMPOSED), COMPOSED), true);
  });

  it('still accepts a hash made from the password as it was typed', async () => {
    const encoded = encodedAt(DECOMPOSED, { memory: 64, passes: 1 });

    assert.equal(await verifyPasswordHash(encoded, DECOMPOSED), true);
    assert.equal(await verifyPasswordHash(encoded, 'cafe creme'), false);
  });
});

describe('passwordHashIsCurrent', () => {
  it('tells a hash made now from one made at other costs', async () => {
    assert.equal(passwordHashIsCurrent(await hashPassword('a password')), true);
    assert.equal(passwordHashIsCurrent(encodedAt('a password', { memory: 64, passes: 1 })), false);
  });
});
