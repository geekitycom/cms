import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';

import { readTar, readTarStream, TAR_END, tarHeader, tarPadding } from './tar.ts';
import type { TarStreamEntry } from './tar.ts';

const execFile = promisify(execFileCallback);

function archive(files: readonly { name: string; mode: number; body: string }[]): Buffer {
  return gzipSync(
    Buffer.concat([
      ...files.flatMap(({ name, mode, body }) => {
        const bytes = Buffer.from(body);
        return [
          tarHeader({ name, mode, size: bytes.length, mtime: new Date('2026-10-14T15:00:00Z') }),
          bytes,
          tarPadding(bytes.length),
        ];
      }),
      TAR_END,
    ]),
  );
}

describe('the tar codec', () => {
  it('reads back each file with its name, mode and bytes', () => {
    const long = `content/uploads/${'a-rather-long-folder-name/'.repeat(8)}photo.jpg`;
    const accented = 'content/posts/café-crème.md';
    const entries = readTar(
      archive([
        { name: 'manifest.json', mode: 0o644, body: '{}' },
        { name: 'data/users.json', mode: 0o600, body: '[]' },
        { name: long, mode: 0o644, body: 'jpeg' },
        { name: accented, mode: 0o644, body: 'Bonjour.' },
      ]),
    );
    assert.deepEqual(
      entries.map(({ name, type, mode, body }) => ({ name, type, mode, body: body.toString() })),
      [
        { name: 'manifest.json', type: 'file', mode: 0o644, body: '{}' },
        { name: 'data/users.json', type: 'file', mode: 0o600, body: '[]' },
        { name: long, type: 'file', mode: 0o644, body: 'jpeg' },
        { name: accented, type: 'file', mode: 0o644, body: 'Bonjour.' },
      ],
    );
  });

  it('writes an archive the system tar lists with the same names and modes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'geekity-tar-'));
    try {
      const long = `content/${'deep/'.repeat(30)}post.md`;
      const file = path.join(dir, 'site.tar.gz');
      await writeFile(
        file,
        archive([
          { name: 'data/users.json', mode: 0o600, body: '[]' },
          { name: long, mode: 0o644, body: 'Hello.' },
        ]),
      );
      const { stdout } = await execFile('tar', ['-tzvf', file]);
      const lines = stdout.trim().split('\n');
      assert.match(lines[0] ?? '', /^-rw------- .* data\/users\.json$/);
      assert.match(lines[1] ?? '', new RegExp(`^-rw-r--r-- .* ${long.replaceAll('/', '\\/')}$`));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('streams the entries of two gzip members read in small chunks, as an export holds them', async () => {
    const big = 'x'.repeat(70_000);
    const manifest = gunzipSync(archive([{ name: 'manifest.json', mode: 0o600, body: '{}' }]));
    const whole = Buffer.concat([
      gzipSync(manifest.subarray(0, -TAR_END.length)),
      archive([
        { name: 'data/users.json', mode: 0o600, body: '[]' },
        { name: 'content/uploads/big.bin', mode: 0o644, body: big },
        { name: 'content/empty.md', mode: 0o644, body: '' },
      ]),
    ]);
    function* chunks(): Generator<Buffer> {
      for (let at = 0; at < whole.length; at += 777) yield whole.subarray(at, at + 777);
    }
    const read: { name: string; type: string; mode: number; size: number; body: string }[] = [];
    for await (const entry of readTarStream(chunks())) {
      read.push({ ...pick(entry), body: await text(entry) });
    }
    assert.deepEqual(read, [
      { name: 'manifest.json', type: 'file', mode: 0o600, size: 2, body: '{}' },
      { name: 'data/users.json', type: 'file', mode: 0o600, size: 2, body: '[]' },
      { name: 'content/uploads/big.bin', type: 'file', mode: 0o644, size: 70_000, body: big },
      { name: 'content/empty.md', type: 'file', mode: 0o644, size: 0, body: '' },
    ]);
  });

  it('skips a body the reader leaves unread, and keeps the modification time', async () => {
    const names: string[] = [];
    let mtime: Date | undefined;
    for await (const entry of readTarStream([
      archive([
        { name: 'a', mode: 0o644, body: 'y'.repeat(1500) },
        { name: 'b', mode: 0o644, body: 'b' },
      ]),
    ])) {
      names.push(entry.name);
      mtime = entry.mtime;
    }
    assert.deepEqual(names, ['a', 'b']);
    assert.equal(mtime?.toISOString(), '2026-10-14T15:00:00.000Z');
  });

  it('refuses an archive cut short inside a body', async () => {
    const tar = gunzipSync(archive([{ name: 'a', mode: 0o644, body: 'z'.repeat(2000) }]));
    await assert.rejects(async () => {
      for await (const entry of readTarStream([gzipSync(tar.subarray(0, 1024))])) {
        await text(entry);
      }
    }, /cut short/);
  });
});

function pick(entry: TarStreamEntry) {
  return { name: entry.name, type: entry.type, mode: entry.mode, size: entry.size };
}

async function text(entry: TarStreamEntry): Promise<string> {
  const pieces: Buffer[] = [];
  for await (const piece of entry.body) pieces.push(piece);
  return Buffer.concat(pieces).toString();
}
