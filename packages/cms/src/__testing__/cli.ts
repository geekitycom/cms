import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';

/**
 * What the CLI's tests need in common: a way to run `geekity` from source, a
 * scratch directory that goes away at the end of the file, and the two or
 * three reads every command's tests do afterwards.
 *
 * It lives here rather than in one test file because the CLI's tests are split
 * one file per command — `node --test` gives each file a process of its own,
 * and a single file holding every command set the floor of the whole parallel
 * suite (TASK-93).
 */

const execFile = promisify(execFileCallback);

/** The root of `@geekity/cms`, the directory holding its `package.json`. */
export const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** The bin, as source. `dist/cli.js` is what a published shim runs instead. */
const CLI = path.join(PACKAGE_ROOT, 'src', 'cli.ts');

/**
 * tsx, as an absolute URL. The CLI is run from a temporary directory, where a
 * bare `--import tsx` has nothing to resolve against.
 */
const TSX = import.meta.resolve('tsx');

/** What running the bin did. Non-zero exits are results here, not throws. */
export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `geekity` from source, the way a bin shim runs `dist/cli.js`.
 *
 * `stdin`, when given, is written to the child and the pipe is closed, which
 * is how a password reaches `user add` without a terminal.
 */
export async function runCli(
  args: readonly string[],
  cwd: string,
  stdin?: string,
): Promise<CliRun> {
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

/** Every directory {@link temporaryDir} handed out, waiting to be removed. */
const temporaryDirs: string[] = [];

/** A temporary directory, removed by {@link cleanupTemporaryDirs}. */
export async function temporaryDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** Remove every {@link temporaryDir}. Call it from the file's `after` hook. */
export async function cleanupTemporaryDirs(): Promise<void> {
  const dirs = temporaryDirs.splice(0, temporaryDirs.length);
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
}

/** A site directory holding these files under `content/`, and nothing else. */
export async function siteWithContent(
  prefix: string,
  files: Record<string, string>,
): Promise<string> {
  const directory = await temporaryDir(prefix);
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(directory, 'content', relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, 'utf8');
  }
  return directory;
}

export async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}
