import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { HANDLES_FILE, handleDirectory, rememberHandles } from './handles.ts';

const alice = {
  profile: 'https://social.example/@alice',
  actor: 'https://social.example/users/alice',
  inbox: 'https://social.example/users/alice/inbox',
  sharedInbox: 'https://social.example/inbox',
};

describe('the handle directory', () => {
  let contentDir: string;
  beforeEach(() => {
    contentDir = mkdtempSync(path.join(tmpdir(), 'geekity-handles-'));
  });
  afterEach(() => {
    rmSync(contentDir, { recursive: true, force: true });
  });

  it('knows nothing when there is no file', () => {
    assert.equal(handleDirectory(contentDir)('alice@social.example'), undefined);
  });

  it('reads back what was remembered, keeping what was there', async () => {
    const read = handleDirectory(contentDir);
    await rememberHandles(contentDir, { 'alice@social.example': alice });
    await rememberHandles(contentDir, {
      'bob@other.example': { ...alice, profile: 'https://other.example/bob' },
    });

    assert.deepEqual(read('alice@social.example'), alice);
    assert.equal(read('bob@other.example')?.profile, 'https://other.example/bob');
    const stored: unknown = JSON.parse(
      readFileSync(path.join(contentDir, ...HANDLES_FILE.split('/')), 'utf8'),
    );
    assert.deepEqual(Object.keys(stored as object), ['alice@social.example', 'bob@other.example']);
  });

  it('skips an entry that is not a resolved account', () => {
    mkdirSync(path.join(contentDir, '_data'));
    writeFileSync(
      path.join(contentDir, ...HANDLES_FILE.split('/')),
      JSON.stringify({
        'bad@x.example': { profile: 'javascript:alert(1)' },
        'alice@social.example': alice,
      }),
    );

    const read = handleDirectory(contentDir);
    assert.equal(read('bad@x.example'), undefined);
    assert.deepEqual(read('alice@social.example'), alice);
  });
});
