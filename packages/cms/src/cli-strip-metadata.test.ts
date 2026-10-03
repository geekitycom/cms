import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, runCli, temporaryDir } from './__testing__/cli.ts';
import {
  jpegWithMetadata,
  leakedSecrets,
  mp4WithLocation,
  pngWithMetadata,
} from './__testing__/metadata.ts';

after(cleanupTemporaryDirs);

describe('geekity strip-metadata', () => {
  /** A site whose content/uploads holds these files, with their mtimes set to a known day. */
  async function site(files: Record<string, Uint8Array>): Promise<string> {
    const directory = await temporaryDir('geekity-strip-');
    for (const [relative, bytes] of Object.entries(files)) {
      const file = path.join(directory, 'content', 'uploads', relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
      await fs.utimes(file, new Date('2025-05-01T00:00:00Z'), new Date('2025-05-01T00:00:00Z'));
    }
    return directory;
  }

  const read = async (directory: string, relative: string): Promise<Uint8Array> =>
    new Uint8Array(await fs.readFile(path.join(directory, 'content', 'uploads', relative)));

  it('strips files already uploaded, reports each one, and keeps their dates', async () => {
    const notes = new TextEncoder().encode('Plain notes.\n');
    const directory = await site({
      '2025/05/beach.jpg': await jpegWithMetadata(6),
      '2025/05/chart.png': await pngWithMetadata(),
      '2025/04/clip.mp4': mp4WithLocation(),
      '2025/04/notes.txt': notes,
    });

    const run = await runCli(['strip-metadata'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /2025\/05\/beach\.jpg: removed .*EXIF/);
    assert.match(run.stdout, /2025\/05\/chart\.png: removed /);
    assert.match(run.stdout, /2025\/04\/clip\.mp4: removed /);
    assert.doesNotMatch(run.stdout, /notes\.txt/);
    assert.match(run.stdout, /Checked 3 files: 3 stripped, 0 already clean, 0 unreadable/);

    for (const relative of ['2025/05/beach.jpg', '2025/05/chart.png', '2025/04/clip.mp4']) {
      assert.deepEqual(leakedSecrets(await read(directory, relative)), [], relative);
      const stat = await fs.stat(path.join(directory, 'content', 'uploads', relative));
      assert.equal(stat.mtime.toISOString(), '2025-05-01T00:00:00.000Z', relative);
    }
    assert.deepEqual(await read(directory, '2025/04/notes.txt'), notes);
  });

  it('changes nothing the second time', async () => {
    const directory = await site({ '2025/05/beach.jpg': await jpegWithMetadata(6) });
    await runCli(['strip-metadata'], directory);
    const once = await read(directory, '2025/05/beach.jpg');

    const run = await runCli(['strip-metadata'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /Checked 1 file: 0 stripped, 1 already clean, 0 unreadable/);
    assert.doesNotMatch(run.stdout, /removed/);
    assert.deepEqual(await read(directory, '2025/05/beach.jpg'), once);
  });

  it('leaves a file it cannot read alone, names it and exits 1', async () => {
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 0x45, 0x78]);
    const directory = await site({
      '2025/05/broken.jpg': broken,
      '2025/05/fine.png': await pngWithMetadata(),
    });

    const run = await runCli(['strip-metadata'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /2025\/05\/broken\.jpg: /);
    assert.match(run.stdout, /Checked 2 files: 1 stripped, 0 already clean, 1 unreadable/);
    assert.deepEqual(await read(directory, '2025/05/broken.jpg'), broken);
  });

  it('says so when there are no uploads', async () => {
    const directory = await temporaryDir('geekity-strip-');

    const run = await runCli(['strip-metadata'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /Checked 0 files/);
  });
});
