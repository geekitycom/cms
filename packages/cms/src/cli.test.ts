import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import { PassThrough } from 'node:stream';

import { cleanupTemporaryDirs, PACKAGE_ROOT, temporaryDir } from './__testing__/cli.ts';
import {
  findSiteTsx,
  loadConfig,
  parseArgs,
  readPassword,
  registerTypeScriptLoader,
} from './cli.ts';

/**
 * The parts of the bin that do not run a command: the argument parser, the
 * password reader, the config lookup and the shim's own resolution.
 *
 * Each command has a file of its own beside this one — `cli-init.test.ts`,
 * `cli-sync.test.ts`, `cli-user.test.ts`, `cli-rebuild.test.ts` and
 * `cli-import.test.ts` — because every one of their tests spawns a child
 * process, and `node --test` runs a file at a time per process (TASK-93).
 */

const execFile = promisify(execFileCallback);

after(cleanupTemporaryDirs);

describe('parseArgs', () => {
  it('defaults to serve when no command is given', () => {
    assert.deepEqual(parseArgs([]), {
      command: 'serve',
      configPath: undefined,
      password: undefined,
      email: undefined,
      flags: {},
      args: [],
    });
  });

  it('reads the serve command', () => {
    assert.deepEqual(parseArgs(['serve']), {
      command: 'serve',
      configPath: undefined,
      password: undefined,
      email: undefined,
      flags: {},
      args: [],
    });
  });

  it('reads an explicit config path', () => {
    assert.deepEqual(parseArgs(['serve', '--config', 'site.config.ts']), {
      command: 'serve',
      configPath: 'site.config.ts',
      password: undefined,
      email: undefined,
      flags: {},
      args: [],
    });
  });

  it('accepts --config=value', () => {
    assert.deepEqual(parseArgs(['--config=site.config.ts']), {
      command: 'serve',
      configPath: 'site.config.ts',
      password: undefined,
      email: undefined,
      flags: {},
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
      email: undefined,
      flags: {},
      args: ['my-site'],
    });
  });

  it('reads the sync command', () => {
    assert.deepEqual(parseArgs(['sync', '--config', 'site.config.ts']), {
      command: 'sync',
      configPath: 'site.config.ts',
      password: undefined,
      email: undefined,
      flags: {},
      args: [],
    });
  });

  it('reads the rebuild command', () => {
    assert.deepEqual(parseArgs(['rebuild']), {
      command: 'rebuild',
      configPath: undefined,
      password: undefined,
      email: undefined,
      flags: {},
      args: [],
    });
  });

  it('reads the user command and its subcommand', () => {
    assert.deepEqual(parseArgs(['user', 'add', 'ada']), {
      command: 'user',
      configPath: undefined,
      password: undefined,
      email: undefined,
      flags: {},
      args: ['add', 'ada'],
    });
  });

  it('reads a password given as a flag', () => {
    assert.deepEqual(parseArgs(['user', 'add', 'ada', '--password', 'hunter22']), {
      command: 'user',
      configPath: undefined,
      password: 'hunter22',
      email: undefined,
      flags: {},
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

  it('reads an email given as a flag, either way of spelling it', () => {
    assert.equal(
      parseArgs(['user', 'add', 'ada', '--email', 'ada@example.com']).email,
      'ada@example.com',
    );
    assert.equal(
      parseArgs(['user', 'add', 'ada', '--email=ada@example.com']).email,
      'ada@example.com',
    );
    assert.deepEqual(parseArgs(['user', 'add', 'ada', '--email', 'ada@example.com']).args, [
      'add',
      'ada',
    ]);
  });

  it('rejects --email with nothing after it', () => {
    assert.throws(() => parseArgs(['user', 'add', 'ada', '--email']), /--email/);
  });

  it('keeps the flags of the command it is running out of its positional arguments', () => {
    assert.deepEqual(parseArgs(['init', 'my-site', '--config=other.ts']).args, ['my-site']);
  });

  it('reads the import command, its subcommand and the flags it carries', () => {
    const parsed = parseArgs([
      'import',
      'wordpress-actor',
      'ada',
      '--actor-id',
      'https://blog.example/?author=2',
      '--wordpress-id=2',
      '--force',
    ]);

    assert.equal(parsed.command, 'import');
    assert.deepEqual(parsed.args, ['wordpress-actor', 'ada']);
    assert.deepEqual(parsed.flags, {
      'actor-id': 'https://blog.example/?author=2',
      'wordpress-id': '2',
      force: true,
    });
  });

  it('rejects an option no command has', () => {
    assert.throws(() => parseArgs(['import', '--nonsense', 'x']), /--nonsense/);
  });

  it('rejects a flag that carries no value', () => {
    assert.throws(
      () => parseArgs(['import', 'wordpress-actor', 'ada', '--actor-id']),
      /--actor-id/,
    );
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

describe('the geekity bin', () => {
  it('prints its version when run through a symlinked path, as a bin shim does', async () => {
    const linkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'geekity-bin-'));
    const link = path.join(linkDir, 'cms');
    await fs.symlink(PACKAGE_ROOT, link, 'dir');

    try {
      const { stdout } = await execFile(
        process.execPath,
        ['--import', 'tsx', path.join(link, 'src', 'cli.ts'), '--version'],
        // Run from the package root so tsx resolves; only the script path is symlinked.
        { cwd: PACKAGE_ROOT },
      );
      assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
    } finally {
      await fs.rm(linkDir, { recursive: true, force: true });
    }
  });
});
