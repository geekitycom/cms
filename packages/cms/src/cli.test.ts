import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';

import { findSiteTsx, loadConfig, parseArgs, registerTypeScriptLoader } from './cli.ts';

const execFile = promisify(execFileCallback);

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PACKAGE_ROOT, 'src', 'cli.ts');

/** What running the bin did. Non-zero exits are results here, not throws. */
interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * tsx, as an absolute URL. The CLI is run from a temporary directory, where a
 * bare `--import tsx` has nothing to resolve against.
 */
const TSX = import.meta.resolve('tsx');

/** Run `geekity` from source, the way a bin shim runs `dist/cli.js`. */
async function runCli(args: readonly string[], cwd: string): Promise<CliRun> {
  try {
    const { stdout, stderr } = await execFile(process.execPath, ['--import', TSX, CLI, ...args], {
      cwd,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

/** A temporary directory, removed when the file finishes. */
const temporaryDirs: string[] = [];
after(async () => {
  await Promise.all(temporaryDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

describe('parseArgs', () => {
  it('defaults to serve when no command is given', () => {
    assert.deepEqual(parseArgs([]), { command: 'serve', configPath: undefined, args: [] });
  });

  it('reads the serve command', () => {
    assert.deepEqual(parseArgs(['serve']), { command: 'serve', configPath: undefined, args: [] });
  });

  it('reads an explicit config path', () => {
    assert.deepEqual(parseArgs(['serve', '--config', 'site.config.ts']), {
      command: 'serve',
      configPath: 'site.config.ts',
      args: [],
    });
  });

  it('accepts --config=value', () => {
    assert.deepEqual(parseArgs(['--config=site.config.ts']), {
      command: 'serve',
      configPath: 'site.config.ts',
      args: [],
    });
  });

  it('recognises help and version flags', () => {
    assert.equal(parseArgs(['--help']).command, 'help');
    assert.equal(parseArgs(['-h']).command, 'help');
    assert.equal(parseArgs(['--version']).command, 'version');
    assert.equal(parseArgs(['-v']).command, 'version');
  });

  it('rejects a command it does not know', () => {
    assert.throws(() => parseArgs(['deploy']), /Unknown command "deploy"/);
  });

  it('rejects --config with nothing after it', () => {
    assert.throws(() => parseArgs(['serve', '--config']), /--config/);
  });

  it('reads the directory init is to create', () => {
    assert.deepEqual(parseArgs(['init', 'my-site']), {
      command: 'init',
      configPath: undefined,
      args: ['my-site'],
    });
  });

  it('reads the sync command', () => {
    assert.deepEqual(parseArgs(['sync', '--config', 'site.config.ts']), {
      command: 'sync',
      configPath: 'site.config.ts',
      args: [],
    });
  });

  it('reads the user command and its subcommand', () => {
    assert.deepEqual(parseArgs(['user', 'add', 'ada']), {
      command: 'user',
      configPath: undefined,
      args: ['add', 'ada'],
    });
  });

  it('keeps the flags of the command it is running out of its positional arguments', () => {
    assert.deepEqual(parseArgs(['init', 'my-site', '--config=other.ts']).args, ['my-site']);
  });
});

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

describe('loadConfig', () => {
  it('is an empty config when the site has no config file', async () => {
    const directory = await temporaryDir('geekity-config-none-');

    assert.deepEqual(await loadConfig(directory, undefined), {});
  });

  it('reads the default export of a JavaScript config', async () => {
    const directory = await temporaryDir('geekity-config-js-');
    await fs.writeFile(
      path.join(directory, 'geekity.config.js'),
      'export default { port: 4321, baseUrl: "https://example.com" };\n',
      'utf8',
    );

    assert.deepEqual(await loadConfig(directory, undefined), {
      port: 4321,
      baseUrl: 'https://example.com',
    });
  });

  it('reads a TypeScript config', async () => {
    const directory = await temporaryDir('geekity-config-ts-');
    await fs.writeFile(
      path.join(directory, 'geekity.config.ts'),
      'const port: number = 4322;\nexport default { port };\n',
      'utf8',
    );

    assert.deepEqual(await loadConfig(directory, undefined), { port: 4322 });
  });

  it('prefers the TypeScript config when a site has both', async () => {
    const directory = await temporaryDir('geekity-config-both-');
    await fs.writeFile(path.join(directory, 'geekity.config.ts'), 'export default { port: 1 };\n');
    await fs.writeFile(path.join(directory, 'geekity.config.js'), 'export default { port: 2 };\n');

    assert.deepEqual(await loadConfig(directory, undefined), { port: 1 });
  });

  it('names the file when --config points at nothing', async () => {
    const directory = await temporaryDir('geekity-config-missing-');

    await assert.rejects(
      () => loadConfig(directory, 'nowhere.config.ts'),
      /Config file not found:.*nowhere\.config\.ts/,
    );
  });

  it('names both fixes when a TypeScript config needs tsx and the site has none', async () => {
    const withoutTsx = await temporaryDir('geekity-no-tsx-');

    await assert.rejects(
      () => registerTypeScriptLoader(withoutTsx, 'geekity.config.ts'),
      (error: Error) => {
        assert.match(error.message, /geekity\.config\.ts/);
        assert.match(error.message, /pnpm add -D tsx/);
        assert.match(error.message, /geekity\.config\.js/);
        return true;
      },
    );
  });
});

describe('findSiteTsx', () => {
  it('finds the tsx the site installed', async () => {
    const site = await temporaryDir('geekity-tsx-');
    await fs.mkdir(path.join(site, 'node_modules', 'tsx'), { recursive: true });
    await fs.writeFile(path.join(site, 'node_modules', 'tsx', 'package.json'), '{}\n', 'utf8');

    assert.equal(findSiteTsx(site), path.join(site, 'node_modules', 'tsx'));
  });

  it('finds one hoisted above a subdirectory of the site', async () => {
    const site = await temporaryDir('geekity-tsx-up-');
    await fs.mkdir(path.join(site, 'node_modules', 'tsx'), { recursive: true });
    await fs.writeFile(path.join(site, 'node_modules', 'tsx', 'package.json'), '{}\n', 'utf8');
    const nested = path.join(site, 'a', 'b');
    await fs.mkdir(nested, { recursive: true });

    assert.equal(findSiteTsx(nested), path.join(site, 'node_modules', 'tsx'));
  });

  it('is undefined when the site has none, whatever this process has loaded', async () => {
    const site = await temporaryDir('geekity-tsx-none-');

    assert.equal(findSiteTsx(site), undefined);
  });
});

describe('geekity sync', () => {
  /** A site directory holding these content files, and nothing else. */
  async function site(files: Record<string, string>): Promise<string> {
    const directory = await temporaryDir('geekity-sync-');
    for (const [relative, text] of Object.entries(files)) {
      const file = path.join(directory, 'content', relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text, 'utf8');
    }
    return directory;
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

describe('geekity user add', () => {
  it('says admin auth has not shipped rather than pretending to make a user', async () => {
    const directory = await temporaryDir('geekity-user-');

    const run = await runCli(['user', 'add', 'ada'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /not available until admin authentication ships/);
  });
});

describe('the geekity bin', () => {
  it('prints its version when run through a symlinked path, as a bin shim does', async () => {
    const packageRoot = path.resolve(import.meta.dirname, '..');
    const linkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'geekity-bin-'));
    const link = path.join(linkDir, 'cms');
    await fs.symlink(packageRoot, link, 'dir');

    try {
      const { stdout } = await execFile(
        process.execPath,
        ['--import', 'tsx', path.join(link, 'src', 'cli.ts'), '--version'],
        // Run from the package root so tsx resolves; only the script path is symlinked.
        { cwd: packageRoot },
      );
      assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
    } finally {
      await fs.rm(linkDir, { recursive: true, force: true });
    }
  });
});
