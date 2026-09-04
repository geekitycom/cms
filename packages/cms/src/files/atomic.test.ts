import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { updateFileAtomically, writeFileAtomically, writeFileAtomicallySync } from './atomic.ts';

const dirs: string[] = [];
after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-atomic-'));
  dirs.push(dir);
  return dir;
}

describe('writeFileAtomically', () => {
  it('writes the file, creates the directory it is in, and leaves no temporary behind', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'nested', 'deeper', 'site.json');

    await writeFileAtomically(file, '{"title":"A Site"}\n');

    assert.equal(await readFile(file, 'utf8'), '{"title":"A Site"}\n');
    assert.deepEqual(await readdir(path.dirname(file)), ['site.json']);
  });

  it('replaces what the file held rather than appending to it', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'site.json');

    await writeFileAtomically(file, 'first');
    await writeFileAtomically(file, 'second');

    assert.equal(await readFile(file, 'utf8'), 'second');
  });

  it('writes bytes as well as text', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'picture.bin');

    await writeFileAtomically(file, new Uint8Array([0, 1, 2, 253]));

    assert.deepEqual(new Uint8Array(await readFile(file)), new Uint8Array([0, 1, 2, 253]));
  });

  it('gives the file the mode it was asked for, and the new file the same one', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'actor.ed25519.jwk');

    await writeFileAtomically(file, '{"kty":"OKP"}', { mode: 0o600 });
    assert.equal((await stat(file)).mode & 0o777, 0o600, 'the first write');

    await writeFileAtomically(file, '{"kty":"RSA"}', { mode: 0o600 });
    assert.equal((await stat(file)).mode & 0o777, 0o600, 'the rewrite');
  });

  it('never lets a reader see a torn file, however many writers there are (AC #5)', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'site.json');
    // Big enough that a single write() would not be atomic on its own: the
    // rename is what makes it so, and the queue is what stops two of them
    // interleaving.
    const bodies = ['a', 'b', 'c', 'd'].map((letter) => `${letter.repeat(200_000)}\n`);

    let torn = 0;
    const readers = setInterval(() => {
      try {
        if (!bodies.includes(readFileSync(file, 'utf8'))) torn += 1;
      } catch {
        // The file does not exist yet, which is not a torn read.
      }
    }, 0);

    await Promise.all(bodies.map((body) => writeFileAtomically(file, body)));
    clearInterval(readers);

    assert.equal(torn, 0, 'every read saw one whole version');
    assert.ok(bodies.includes(await readFile(file, 'utf8')), 'the file holds one whole version');
    assert.deepEqual(await readdir(dir), ['site.json'], 'no temporary file survived');
  });
});

describe('updateFileAtomically', () => {
  it('hands the current contents to the producer, and undefined when there is no file', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'site.json');

    const seen: (string | undefined)[] = [];
    await updateFileAtomically(file, (current) => {
      seen.push(current);
      return 'one';
    });
    await updateFileAtomically(file, (current) => {
      seen.push(current);
      return `${current ?? ''} two`;
    });

    assert.deepEqual(seen, [undefined, 'one']);
    assert.equal(await readFile(file, 'utf8'), 'one two');
  });

  it('runs the read and the write as one step, so concurrent updates cannot lose one', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'counter.json');
    await writeFile(file, JSON.stringify({ count: 0 }), 'utf8');

    await Promise.all(
      Array.from({ length: 20 }, () =>
        updateFileAtomically(file, async (current) => {
          const count = Number((JSON.parse(current ?? '{}') as { count: number }).count);
          // A turn of the loop between the read and the write is exactly what
          // a real producer does, and what a lock that only covered the write
          // would let another writer slip into.
          await Promise.resolve();
          return JSON.stringify({ count: count + 1 });
        }),
      ),
    );

    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { count: 20 });
  });
});

describe('writeFileAtomicallySync', () => {
  it('writes the file the same way for a caller that cannot await, mode and all', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, '_data', 'site.json');

    writeFileAtomicallySync(file, '{"title":"Booted"}\n', { mode: 0o600 });

    assert.equal(await readFile(file, 'utf8'), '{"title":"Booted"}\n');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(path.dirname(file)), ['site.json']);
  });
});
