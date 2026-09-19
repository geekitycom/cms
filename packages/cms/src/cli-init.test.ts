import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  cleanupTemporaryDirs,
  PACKAGE_ROOT,
  readJson,
  runCli,
  temporaryDir,
} from './__testing__/cli.ts';

after(cleanupTemporaryDirs);

describe('geekity init', () => {
  it('scaffolds a site that is ready to install and run', async () => {
    const parent = await temporaryDir('geekity-init-');

    const run = await runCli(['init', 'my-site'], parent);

    assert.equal(run.code, 0, run.stderr);
    const site = path.join(parent, 'my-site');
    const entries = await fs.readdir(site);
    assert.deepEqual(entries.sort(), [
      '.gitignore',
      'content',
      'geekity.config.ts',
      'package.json',
      'pnpm-workspace.yaml',
      'server.ts',
      'tsconfig.json',
    ]);
  });

  it('writes a package.json that depends on the version of the CLI that wrote it', async () => {
    const parent = await temporaryDir('geekity-init-pkg-');
    await runCli(['init', 'my-site'], parent);

    const manifest = await readJson(path.join(parent, 'my-site', 'package.json'));
    const own = await readJson(path.join(PACKAGE_ROOT, 'package.json'));

    assert.equal(manifest['name'], 'my-site');
    assert.equal(manifest['type'], 'module');
    assert.equal(manifest['private'], true);
    assert.equal(
      (manifest['dependencies'] as Record<string, string>)['@geekity/cms'],
      `^${String(own['version'])}`,
    );
    assert.deepEqual(Object.keys(manifest['scripts'] as object).sort(), ['dev', 'start', 'sync']);
  });

  it('settles what pnpm would otherwise stop and ask about, so the install is unattended', async () => {
    const parent = await temporaryDir('geekity-init-pnpm-');
    await runCli(['init', 'my-site'], parent);

    // pnpm 11 reads settings only from pnpm-workspace.yaml; the `pnpm` field in
    // package.json is ignored, so nothing may live there.
    const manifest = await readJson(path.join(parent, 'my-site', 'package.json'));
    assert.equal(manifest['pnpm'], undefined);

    const settings = await fs.readFile(path.join(parent, 'my-site', 'pnpm-workspace.yaml'), 'utf8');
    // esbuild's install script, which pnpm blocks by default; tsx needs it.
    assert.match(settings, /^allowBuilds:\n {2}esbuild: true$/m);
    // nunjucks names chokidar an optional peer at a major the CMS is past.
    assert.match(settings, /^ {4}nunjucks>chokidar: '5'$/m);
  });

  it('gives the site the TypeScript toolchain its scripts and its config need', async () => {
    const parent = await temporaryDir('geekity-init-tools-');
    await runCli(['init', 'my-site'], parent);

    const manifest = await readJson(path.join(parent, 'my-site', 'package.json'));
    const devDependencies = manifest['devDependencies'] as Record<string, string>;

    assert.deepEqual(Object.keys(devDependencies).sort(), ['@types/node', 'tsx', 'typescript']);
  });

  it('ships a published post and a page the site serves out of the box', async () => {
    const parent = await temporaryDir('geekity-init-content-');
    await runCli(['init', 'my-site'], parent);
    const content = path.join(parent, 'my-site', 'content');

    const posts = await fs.readdir(path.join(content, 'posts'));
    const pages = await fs.readdir(path.join(content, 'pages'));
    const site = await readJson(path.join(content, '_data', 'site.json'));

    assert.ok(
      posts.some((name) => name.endsWith('.md')),
      `expected a sample post, found ${posts.join(', ')}`,
    );
    assert.ok(
      pages.some((name) => name.endsWith('.md')),
      `expected a sample page, found ${pages.join(', ')}`,
    );
    assert.equal(typeof site['title'], 'string');

    const post = await fs.readFile(
      path.join(content, 'posts', posts.filter((name) => name.endsWith('.md'))[0] as string),
      'utf8',
    );
    assert.match(post, /^permalink: \//m);
    assert.doesNotMatch(post, /^draft: true$/m);
  });

  it('refuses a directory that already has something in it', async () => {
    const parent = await temporaryDir('geekity-init-busy-');
    await fs.mkdir(path.join(parent, 'my-site'));
    await fs.writeFile(path.join(parent, 'my-site', 'README.md'), '# mine\n', 'utf8');

    const run = await runCli(['init', 'my-site'], parent);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /not empty/i);
    assert.deepEqual(await fs.readdir(path.join(parent, 'my-site')), ['README.md']);
  });

  it('needs a directory to create', async () => {
    const parent = await temporaryDir('geekity-init-bare-');

    const run = await runCli(['init'], parent);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /geekity init <directory>/);
  });
});
