import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

import { readTar, TAR_END, tarHeader, tarPadding } from './tar.ts';

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
});
