import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, exists, runCli, siteWithContent } from './__testing__/cli.ts';

after(cleanupTemporaryDirs);

describe('geekity sync', () => {
  /** A site directory holding these content files, and nothing else. */
  async function site(files: Record<string, string>): Promise<string> {
    return await siteWithContent('geekity-sync-', files);
  }

  it('rebuilds the index, reports what it did and exits 0', async () => {
    const directory = await site({
      'posts/2026-01-01-one.md': '---\ntitle: One\npermalink: /one/\n---\n\nOne.\n',
      'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout.\n',
    });

    const run = await runCli(['sync'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /Scanned 2/);
    assert.match(run.stdout, /2 created/);
    assert.ok(await exists(path.join(directory, 'data', 'geekity.db')));
  });

  it('leaves the index in place, so a second run has nothing to do', async () => {
    const directory = await site({
      'posts/2026-01-01-one.md': '---\ntitle: One\npermalink: /one/\n---\n\nOne.\n',
    });
    await runCli(['sync'], directory);

    const run = await runCli(['sync'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /0 created/);
    assert.match(run.stdout, /1 unchanged/);
  });

  it('exits non-zero and says so when a file will not parse', async () => {
    const directory = await site({
      'posts/2026-01-01-one.md': '---\ntitle: One\npermalink: /one/\n---\n\nOne.\n',
      'posts/2026-01-02-broken.md': '---\ntitle: [unclosed\n---\n\nBroken.\n',
    });

    const run = await runCli(['sync'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stdout, /1 failed/);
    assert.match(run.stderr, /could not be parsed/);
    assert.match(run.stderr, /2026-01-02-broken\.md/);
  });

  it('scans once and returns rather than sitting in the watcher', async () => {
    const directory = await site({
      'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout.\n',
    });
    await fs.writeFile(
      path.join(directory, 'geekity.config.js'),
      'export default { watch: true };\n',
      'utf8',
    );

    // execFile resolving at all is the assertion: a run that kept watching
    // would hang here until the test runner's timeout.
    const run = await runCli(['sync'], directory);

    assert.equal(run.code, 0, run.stderr);
  });
});
