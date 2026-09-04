import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { PassThrough } from 'node:stream';

import {
  findSiteTsx,
  loadConfig,
  parseArgs,
  readPassword,
  registerTypeScriptLoader,
} from './cli.ts';
import { createCms, listUsers, MINIMUM_PASSWORD_LENGTH } from './index.ts';

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

/**
 * Run `geekity` from source, the way a bin shim runs `dist/cli.js`.
 *
 * `stdin`, when given, is written to the child and the pipe is closed, which
 * is how a password reaches `user add` without a terminal.
 */
async function runCli(args: readonly string[], cwd: string, stdin?: string): Promise<CliRun> {
  try {
    const running = execFile(process.execPath, ['--import', TSX, CLI, ...args], { cwd });
    if (stdin !== undefined) running.child.stdin?.end(stdin);
    const { stdout, stderr } = await running;
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
    assert.deepEqual(parseArgs([]), {
      command: 'serve',
      configPath: undefined,
      password: undefined,
      args: [],
    });
  });

  it('reads the serve command', () => {
    assert.deepEqual(parseArgs(['serve']), {
      command: 'serve',
      configPath: undefined,
      password: undefined,
      args: [],
    });
  });

  it('reads an explicit config path', () => {
    assert.deepEqual(parseArgs(['serve', '--config', 'site.config.ts']), {
      command: 'serve',
      configPath: 'site.config.ts',
      password: undefined,
      args: [],
    });
  });

  it('accepts --config=value', () => {
    assert.deepEqual(parseArgs(['--config=site.config.ts']), {
      command: 'serve',
      configPath: 'site.config.ts',
      password: undefined,
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
      password: undefined,
      args: ['my-site'],
    });
  });

  it('reads the sync command', () => {
    assert.deepEqual(parseArgs(['sync', '--config', 'site.config.ts']), {
      command: 'sync',
      configPath: 'site.config.ts',
      password: undefined,
      args: [],
    });
  });

  it('reads the rebuild command', () => {
    assert.deepEqual(parseArgs(['rebuild']), {
      command: 'rebuild',
      configPath: undefined,
      password: undefined,
      args: [],
    });
  });

  it('reads the user command and its subcommand', () => {
    assert.deepEqual(parseArgs(['user', 'add', 'ada']), {
      command: 'user',
      configPath: undefined,
      password: undefined,
      args: ['add', 'ada'],
    });
  });

  it('reads a password given as a flag', () => {
    assert.deepEqual(parseArgs(['user', 'add', 'ada', '--password', 'hunter22']), {
      command: 'user',
      configPath: undefined,
      password: 'hunter22',
      args: ['add', 'ada'],
    });
  });

  it('accepts --password=value, so a password may start with a dash', () => {
    assert.equal(parseArgs(['user', 'add', 'ada', '--password=--dash--']).password, '--dash--');
  });

  it('accepts an empty --password=, so the refusal comes from the rules not the parser', () => {
    assert.equal(parseArgs(['user', 'add', 'ada', '--password=']).password, '');
  });

  it('rejects --password with nothing after it', () => {
    assert.throws(() => parseArgs(['user', 'add', 'ada', '--password']), /--password/);
  });

  it('keeps the flags of the command it is running out of its positional arguments', () => {
    assert.deepEqual(parseArgs(['init', 'my-site', '--config=other.ts']).args, ['my-site']);
  });
});

describe('readPassword', () => {
  /** A stream of `text`, pretending to be a terminal when `isTTY`. */
  function input(text: string, isTTY = false): PassThrough & { isTTY?: boolean } {
    const stream: PassThrough & { isTTY?: boolean } = new PassThrough();
    if (isTTY) stream.isTTY = true;
    stream.end(text);
    return stream;
  }

  /** A writable that keeps everything written to it. */
  function output(): PassThrough & { text(): string } {
    const chunks: string[] = [];
    const stream = new PassThrough();
    stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
    return Object.assign(stream, { text: () => chunks.join('') });
  }

  it('reads one line from a pipe, so a password can be scripted', async () => {
    const out = output();

    const password = await readPassword({ input: input('hunter22\n'), output: out });

    assert.equal(password, 'hunter22');
  });

  it('takes only the first line, whatever else is on the pipe', async () => {
    const password = await readPassword({ input: input('hunter22\nrubbish\n') });

    assert.equal(password, 'hunter22');
  });

  it('reads a last line that has no newline after it', async () => {
    assert.equal(await readPassword({ input: input('hunter22') }), 'hunter22');
  });

  it('prompts nobody when the input is a pipe, so the password is not in the output', async () => {
    const out = output();

    await readPassword({ input: input('hunter22\n'), output: out, prompt: 'Password: ' });

    assert.equal(out.text(), '');
  });

  it('prompts on a terminal but never echoes what is typed', async () => {
    const out = output();

    const password = await readPassword({
      input: input('hunter22\n', true),
      output: out,
      prompt: 'Password: ',
    });

    assert.equal(password, 'hunter22');
    assert.match(out.text(), /^Password: /);
    assert.doesNotMatch(out.text(), /hunter22/);
  });

  it('puts a real terminal into raw mode, so the driver does not echo either', async () => {
    const stream: PassThrough & {
      isTTY?: boolean;
      isRaw?: boolean;
      setRawMode?: (mode: boolean) => void;
    } = new PassThrough();
    const modes: boolean[] = [];
    stream.isTTY = true;
    stream.isRaw = false;
    stream.setRawMode = (mode: boolean) => {
      modes.push(mode);
      stream.isRaw = mode;
    };
    stream.end('hunter22\n');

    await readPassword({ input: stream, output: output() });

    // On: the terminal driver would otherwise print the password itself.
    // Off again: the shell that gets the terminal back expects it cooked.
    assert.equal(modes[0], true);
    assert.equal(modes.at(-1), false);
    assert.equal(stream.isRaw, false);
  });

  it('gives up with a clear message when the prompt is interrupted', async () => {
    const stream: PassThrough & { isTTY?: boolean; setRawMode?: (mode: boolean) => void } =
      new PassThrough();
    stream.isTTY = true;
    stream.setRawMode = () => undefined;
    // In raw mode Ctrl-C arrives as a byte, which readline turns into SIGINT.
    stream.end('\u0003');

    await assert.rejects(() => readPassword({ input: stream, output: output() }), /cancelled/i);
  });

  it('refuses input that ends without a password', async () => {
    await assert.rejects(() => readPassword({ input: input('') }), /no password/i);
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
  /** The usernames in a site's `data/users.json`, read as the CMS reads it. */
  function usernames(directory: string): string[] {
    return listUsers(path.join(directory, 'data')).map((user) => user.username);
  }

  it('creates an admin and says which one', async () => {
    const directory = await temporaryDir('geekity-user-add-');

    const run = await runCli(['user', 'add', 'ada', '--password', 'hunter22'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /ada/);
    assert.deepEqual(usernames(directory), ['ada']);
  });

  it('creates a user who can then log in through /admin/login', async () => {
    const directory = await temporaryDir('geekity-user-login-');
    const run = await runCli(['user', 'add', 'ada', '--password', 'hunter22'], directory);
    assert.equal(run.code, 0, run.stderr);

    const cms = createCms({
      contentDir: path.join(directory, 'content'),
      dataDir: path.join(directory, 'data'),
      watch: false,
    });
    try {
      // A user exists, so setup is closed and the login form is the way in.
      const form = await cms.app.request('/admin/login');
      assert.equal(form.status, 200);
      const html = await form.text();
      const token = /name="csrf_token"\s+value="([^"]+)"/.exec(html)?.[1];
      assert.ok(token, 'expected a CSRF token on the login form');
      const cookie = (form.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '';

      const response = await cms.app.request('/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: new URLSearchParams({
          username: 'ada',
          password: 'hunter22',
          csrf_token: token,
        }).toString(),
      });

      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/admin');
    } finally {
      await cms.close();
    }
  });

  it('reads the password from stdin when the flag is absent', async () => {
    const directory = await temporaryDir('geekity-user-stdin-');

    const run = await runCli(['user', 'add', 'ada'], directory, 'hunter22\n');

    assert.equal(run.code, 0, run.stderr);
    assert.deepEqual(usernames(directory), ['ada']);
    // Nothing is prompted off a terminal, and the password is never echoed.
    assert.doesNotMatch(run.stdout + run.stderr, /hunter22/);
  });

  it('refuses a name that is already taken and adds nobody', async () => {
    const directory = await temporaryDir('geekity-user-dup-');
    await runCli(['user', 'add', 'ada', '--password', 'hunter22'], directory);

    const run = await runCli(['user', 'add', 'ada', '--password', 'different1'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /already exists/i);
    assert.deepEqual(usernames(directory), ['ada']);
  });

  it('refuses a username the setup form would refuse', async () => {
    const directory = await temporaryDir('geekity-user-bad-');

    const run = await runCli(['user', 'add', 'ada lovelace', '--password', 'hunter22'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /username/i);
    assert.deepEqual(usernames(directory), []);
  });

  it('refuses a password shorter than the setup form would accept', async () => {
    const directory = await temporaryDir('geekity-user-short-');

    const run = await runCli(['user', 'add', 'ada', '--password', 'short'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, new RegExp(String(MINIMUM_PASSWORD_LENGTH)));
    assert.deepEqual(usernames(directory), []);
  });

  it('needs a username', async () => {
    const directory = await temporaryDir('geekity-user-bare-');

    const run = await runCli(['user', 'add'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /geekity user add <username>/);
  });

  it('names the subcommand it has when given one it does not', async () => {
    const directory = await temporaryDir('geekity-user-sub-');

    const run = await runCli(['user', 'remove', 'ada'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /add/);
  });

  it('puts the user where the config says the data lives', async () => {
    const directory = await temporaryDir('geekity-user-config-');
    await fs.writeFile(
      path.join(directory, 'site.config.js'),
      "export default { dataDir: 'elsewhere' };\n",
      'utf8',
    );

    const run = await runCli(
      ['user', 'add', 'ada', '--password', 'hunter22', '--config', 'site.config.js'],
      directory,
    );

    assert.equal(run.code, 0, run.stderr);
    assert.ok(await exists(path.join(directory, 'elsewhere', 'geekity.db')));
    assert.ok(!(await exists(path.join(directory, 'data'))));
  });
});

describe('geekity rebuild', () => {
  const ADA = 'https://remote.example/users/ada';

  /** A site directory holding these files under `content/`, and nothing else. */
  async function site(files: Record<string, string>): Promise<string> {
    const directory = await temporaryDir('geekity-rebuild-');
    for (const [relative, text] of Object.entries(files)) {
      const file = path.join(directory, 'content', relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text, 'utf8');
    }
    return directory;
  }

  /** A federated site: two posts, one follower, two inbound activities. */
  async function federatedSite(): Promise<string> {
    return await site({
      'posts/2026-01-01-one.md': '---\ntitle: One\npermalink: /one/\n---\n\nOne.\n',
      'posts/2026-01-02-two.md': '---\ntitle: Two\npermalink: /two/\n---\n\nTwo.\n',
      '_data/federation/followers.json': `${JSON.stringify(
        [
          {
            actorId: ADA,
            inboxId: `${ADA}/inbox`,
            sharedInboxId: null,
            handle: '@ada@remote.example',
            name: 'Ada Lovelace',
            iconUrl: null,
            url: 'https://remote.example/@ada',
            followedAt: '2026-01-03T10:00:00.000Z',
          },
        ],
        null,
        2,
      )}\n`,
      '_data/federation/inbox/2026-01.jsonl': [
        JSON.stringify({
          receivedAt: '2026-01-04T10:00:00.000Z',
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://remote.example/likes/1',
          type: 'Like',
          actor: ADA,
          object: 'https://blog.example/ap/posts/one',
        }),
        JSON.stringify({
          receivedAt: '2026-01-05T10:00:00.000Z',
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://remote.example/announces/1',
          type: 'Announce',
          actor: ADA,
          object: 'https://blog.example/ap/posts/two',
        }),
        '',
      ].join('\n'),
    });
  }

  it('deletes the database and reports what it read back out of the files', async () => {
    const directory = await federatedSite();
    const database = path.join(directory, 'data', 'geekity.db');
    await runCli(['sync'], directory);
    // Something the rebuild must not carry over: a table nothing in the files
    // says anything about. Its absence afterwards is what proves the file was
    // replaced rather than migrated in place — an inode comparison would say
    // the same on macOS, but Linux hands a deleted file's inode straight to
    // the next file created in the directory.
    const marker = new DatabaseSync(database);
    marker.exec('CREATE TABLE leftover (x)');
    marker.close();

    const run = await runCli(['rebuild'], directory);

    assert.equal(run.code, 0, run.stderr);
    const rebuilt = new DatabaseSync(database);
    const leftover = rebuilt
      .prepare("SELECT name FROM sqlite_master WHERE name = 'leftover'")
      .all();
    rebuilt.close();
    assert.equal(leftover.length, 0, 'a different file entirely');
    assert.match(run.stdout, /Rebuilt/);
    assert.match(run.stdout, /geekity\.db/);
    assert.match(run.stdout, /Scanned 2: 2 created/);
    assert.match(run.stdout, /1 follower/);
    assert.match(run.stdout, /2 inbox activities/);
  });

  it('builds one for a site that has never had a database', async () => {
    const directory = await federatedSite();

    const run = await runCli(['rebuild'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /2 created/);
    assert.ok(await exists(path.join(directory, 'data', 'geekity.db')));
  });

  it('is the way past a database the site would otherwise refuse to open', async () => {
    const directory = await federatedSite();
    await fs.mkdir(path.join(directory, 'data'), { recursive: true });
    await fs.writeFile(path.join(directory, 'data', 'geekity.db'), 'not a database\n', 'utf8');

    const refused = await runCli(['sync'], directory);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /geekity rebuild/);

    const run = await runCli(['rebuild'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /2 created/);
  });

  it('refuses while a server holds the database, and leaves it where it is', async () => {
    const directory = await federatedSite();
    await runCli(['sync'], directory);
    const database = path.join(directory, 'data', 'geekity.db');
    const before = (await fs.stat(database)).ino;

    const cms = createCms({
      contentDir: path.join(directory, 'content'),
      dataDir: path.join(directory, 'data'),
      watch: false,
    });
    try {
      const run = await runCli(['rebuild'], directory);

      assert.equal(run.code, 1);
      assert.match(run.stderr, /in use/);
      assert.equal((await fs.stat(database)).ino, before);
    } finally {
      await cms.close();
    }
  });

  it('exits non-zero and says so when a file will not parse', async () => {
    const directory = await site({
      'posts/2026-01-01-one.md': '---\ntitle: One\npermalink: /one/\n---\n\nOne.\n',
      'posts/2026-01-02-broken.md': '---\ntitle: [unclosed\n---\n\nBroken.\n',
    });

    const run = await runCli(['rebuild'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stdout, /1 failed/);
    assert.match(run.stderr, /could not be parsed/);
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
