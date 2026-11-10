import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

import {
  readFileIfPresentSync,
  refuseWritesUnder,
  updateFileAtomically,
  WritesRefusedError,
  withFileLock,
  writeFileAtomically,
  writeFileAtomicallySync,
} from './atomic.ts';

const execFile = promisify(execFileCallback);
const OTHER_PROCESS = path.join(import.meta.dirname, '__fixtures__', 'update-process.ts');

const dirs: string[] = [];
after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-atomic-'));
  dirs.push(dir);
  return dir;
}

// Permission bits do not stop root, and Windows does not have them.
const runsAsRootOrWindows = process.getuid?.() === 0 || process.platform === 'win32';

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

  it('keeps every change two processes make to one file', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'users.json');
    await writeFile(file, '{}');

    await Promise.all(
      ['a', 'b'].map((prefix) =>
        execFile(process.execPath, [OTHER_PROCESS, file, prefix, '30'], { timeout: 30_000 }),
      ),
    );

    const keys = Object.keys(JSON.parse(await readFile(file, 'utf8')) as object);
    assert.equal(keys.length, 60, `only ${String(keys.length)} of 60 changes survived`);
    assert.deepEqual(await readdir(dir), ['users.json']);
  });
  it(
    'refuses to write over a file it cannot read, and leaves its bytes alone',
    { skip: runsAsRootOrWindows },
    async () => {
      const dir = await temporaryDir();
      const file = path.join(dir, 'state.json');
      await writeFile(file, '{"kept":true}\n');
      await chmod(file, 0o000);

      let produced = false;
      try {
        await assert.rejects(
          updateFileAtomically(file, () => {
            produced = true;
            return '{"replaced":true}\n';
          }),
          { code: 'EACCES' },
        );
      } finally {
        await chmod(file, 0o600);
      }

      assert.equal(produced, false);
      assert.equal(await readFile(file, 'utf8'), '{"kept":true}\n');
    },
  );
});

describe('readFileIfPresentSync', () => {
  it('reads a missing file as undefined', async () => {
    const dir = await temporaryDir();

    assert.equal(readFileIfPresentSync(path.join(dir, 'missing.json')), undefined);
  });

  it('throws for a path it cannot read as a file', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'users.json');
    await mkdir(file);

    assert.throws(() => readFileIfPresentSync(file), { code: 'EISDIR' });
  });

  it('throws for a file it is not allowed to read', { skip: runsAsRootOrWindows }, async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'users.json');
    await writeFile(file, '{}');
    await chmod(file, 0o000);

    try {
      assert.throws(() => readFileIfPresentSync(file), { code: 'EACCES' });
    } finally {
      await chmod(file, 0o600);
    }
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

describe('withFileLock', () => {
  it('runs one task at a time per path and hands back what the task returned', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'followers.json');

    const order: string[] = [];
    const results = await Promise.all(
      ['a', 'b', 'c'].map((name) =>
        withFileLock(file, async () => {
          order.push(`${name}:start`);
          await Promise.resolve();
          order.push(`${name}:end`);
          return name.toUpperCase();
        }),
      ),
    );

    assert.deepEqual(results, ['A', 'B', 'C']);
    assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('holds the lock over everything the task does, writes and their index alike', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'followers.json');
    const index: string[] = [];

    // What every writer in this CMS does: read the file, write it back, and
    // bring a cache into line with it. The cache write is inside the lock, so
    // an add racing a remove cannot leave the cache saying what the file does
    // not.
    async function add(name: string): Promise<void> {
      await withFileLock(file, async () => {
        const held = JSON.parse(readFileIfPresentSync(file) ?? '[]') as string[];
        await Promise.resolve();
        const next = [...held, name];
        writeFileAtomicallySync(file, JSON.stringify(next));
        index.length = 0;
        index.push(...next);
      });
    }

    await Promise.all(['ada', 'grace', 'katherine'].map(add));

    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), ['ada', 'grace', 'katherine']);
    assert.deepEqual(index, ['ada', 'grace', 'katherine']);
  });

  it('lets the next task run after one throws, and reports the throw to its own caller', async () => {
    const dir = await temporaryDir();
    const file = path.join(dir, 'followers.json');

    const failed = withFileLock(file, () => {
      throw new Error('the file would not parse');
    });
    const after = withFileLock(file, () => 'ran anyway');

    await assert.rejects(failed, /the file would not parse/);
    assert.equal(await after, 'ran anyway');
  });

  it('does not serialise tasks on different paths', async () => {
    const dir = await temporaryDir();
    let started = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withFileLock(path.join(dir, 'one.json'), async () => {
      started += 1;
      await held;
    });
    const second = withFileLock(path.join(dir, 'two.json'), () => {
      started += 1;
    });

    await second;
    assert.equal(started, 2, 'the second path waited for the first');
    release();
    await first;
  });
});

describe('refuseWritesUnder', () => {
  it('refuses every write under the directory until released, and leaves the file as it was', async () => {
    const dir = await temporaryDir();
    const outside = await temporaryDir();
    const file = path.join(dir, 'data', 'site.json');
    await writeFileAtomically(file, 'before');

    const release = refuseWritesUnder([dir]);
    await assert.rejects(writeFileAtomically(file, 'after'), WritesRefusedError);
    await assert.rejects(
      updateFileAtomically(file, () => 'after'),
      WritesRefusedError,
    );
    assert.throws(() => writeFileAtomicallySync(file, 'after'), WritesRefusedError);
    assert.throws(
      () => writeFileAtomicallySync(path.join(dir, 'new', 'file.json'), 'x'),
      WritesRefusedError,
    );
    assert.equal(readFileSync(file, 'utf8'), 'before');
    assert.equal(readFileIfPresentSync(path.join(dir, 'new', 'file.json')), undefined);

    await writeFileAtomically(path.join(outside, 'free.json'), 'yes');
    assert.equal(readFileSync(path.join(outside, 'free.json'), 'utf8'), 'yes');

    release();
    await writeFileAtomically(file, 'after');
    assert.equal(readFileSync(file, 'utf8'), 'after');
  });

  it('does not refuse a sibling directory that only shares the prefix', async () => {
    const dir = await temporaryDir();
    const release = refuseWritesUnder([path.join(dir, 'data')]);
    try {
      await writeFileAtomically(path.join(dir, 'data-old', 'x.json'), 'ok');
    } finally {
      release();
    }
  });
});
