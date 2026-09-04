import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Writing a file the way decision-9 needs it written.
 *
 * Files are the source of truth for everything durable, and SQLite is a cache
 * that may be deleted — which means the transactions that used to cover a
 * settings save or a new follower cover nothing any more. Two properties take
 * their place, and both live here so no caller has to remember them:
 *
 * - **Atomic.** The bytes go to a temporary sibling and are renamed over the
 *   target, and `rename(2)` within one directory is atomic. A reader — an
 *   Eleventy build, the site data source, another process entirely — sees the
 *   whole old file or the whole new one, never half of either, and a crash
 *   half way through leaves the old file intact.
 * - **Serialised.** Every write to one path queues behind the last, in this
 *   process, so two requests that both rewrite `site.json` cannot interleave.
 *   {@link updateFileAtomically} puts the read inside that queue as well,
 *   which is what stops the second writer reading the file before the first
 *   has written it and then overwriting what it wrote.
 *
 * The queue is per path, so writes to different files still run at once, and
 * a path is forgotten again as soon as its queue drains.
 */

/** What every write here takes besides the bytes. */
export interface WriteFileAtomicallyOptions {
  /**
   * The permissions the file ends up with, e.g. `0o600` for a private key.
   *
   * It is applied to the temporary file before the rename, so the bytes are
   * never readable by anybody the finished file would not be readable by.
   * Left off, the file is created with the process's usual mode — and, because
   * the rename replaces the target rather than writing through it, that is
   * true of a rewrite too: the mode is the one named here, not the one the old
   * file happened to have.
   */
  mode?: number | undefined;
}

/** What a write puts in a file: text, or bytes as they are. */
export type FileContents = string | Uint8Array;

/**
 * Produce the new contents from the current ones.
 *
 * `current` is `undefined` when the file does not exist yet, which is a real
 * state rather than an error: the first follower, the first settings save on a
 * site that has no `site.json`.
 */
export type ProduceFileContents = (
  current: string | undefined,
) => FileContents | Promise<FileContents>;

/** One path's queue: what the next task waits on, and how many are in it. */
interface FileQueue {
  /** Settles when everything queued so far has finished, however it finished. */
  last: Promise<unknown>;
  /** How many tasks are queued or running. The last one out drops the entry. */
  waiting: number;
}

/** Every path with a write queued, keyed by its resolved absolute path. */
const queues = new Map<string, FileQueue>();

/**
 * Write a file atomically, behind whatever is already being written to it.
 *
 * The directory it lives in is created if it is missing, so a caller writing
 * the first file under `data/keys` or `content/_data` does not have to.
 */
export function writeFileAtomically(
  file: string,
  contents: FileContents,
  options: WriteFileAtomicallyOptions = {},
): Promise<void> {
  return enqueue(file, () => write(file, contents, options));
}

/**
 * Read a file, decide what it should say next, and write it — all three as one
 * step nothing else writing that file can get between.
 *
 * The read-modify-write is the shape almost every file in this CMS is changed
 * by: `site.json` keeps the keys the settings form does not manage,
 * `followers.json` gains or loses one entry, a month's inbox log gains a line.
 * A queue around the write alone would not be enough for any of them, because
 * two writers could both read the old file first.
 */
export function updateFileAtomically(
  file: string,
  produce: ProduceFileContents,
  options: WriteFileAtomicallyOptions = {},
): Promise<void> {
  return enqueue(file, async () => {
    let current: string | undefined;
    try {
      current = await readFile(file, 'utf8');
    } catch {
      current = undefined;
    }
    await write(file, await produce(current), options);
  });
}

/**
 * The same write for a caller that cannot await: boot.
 *
 * `createCms` is synchronous — a site calls it and reads `cms.app` — so the
 * once-only migrations that turn an old database's rows into files have no
 * `await` to spend. They run before the server is listening and before
 * anything else has written a file, so stepping outside the queue costs
 * nothing; the rename still makes the write atomic against a reader.
 */
export function writeFileAtomicallySync(
  file: string,
  contents: FileContents,
  options: WriteFileAtomicallyOptions = {},
): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = temporaryName(file);

  try {
    writeFileSync(temporary, contents, options.mode === undefined ? {} : { mode: options.mode });
    renameSync(temporary, file);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // It was never created, or the rename already moved it away.
    }
    throw error;
  }
}

/**
 * Read a file's whole contents as text, or `undefined` when it is not there.
 *
 * The counterpart of the writes above, for the same reason they exist: a file
 * that is the source of truth is read on the way to being written, and a
 * missing one means "nothing stored yet" everywhere in this CMS rather than an
 * error to handle at each call site.
 */
export function readFileIfPresentSync(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Run a task once every task already queued for this path has finished. */
function enqueue(file: string, task: () => Promise<void>): Promise<void> {
  const key = path.resolve(file);
  const queue = queues.get(key) ?? { last: Promise.resolve(), waiting: 0 };
  queue.waiting += 1;
  queues.set(key, queue);

  // The chain is of settled promises: a task that throws still lets the next
  // one run, and its rejection reaches only the caller that queued it.
  const next = queue.last.then(task, task);
  queue.last = next.catch(() => undefined);

  return next.finally(() => {
    // The last one out turns the light off, so a process that has been running
    // for a year does not hold an entry per file it has ever written.
    queue.waiting -= 1;
    if (queue.waiting === 0 && queues.get(key) === queue) queues.delete(key);
  });
}

/** The write itself: a temporary sibling, then a rename over the target. */
async function write(
  file: string,
  contents: FileContents,
  options: WriteFileAtomicallyOptions,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = temporaryName(file);

  try {
    await writeFile(temporary, contents, options.mode === undefined ? {} : { mode: options.mode });
    await rename(temporary, file);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch {
      // It was never created, or the rename already moved it away.
    }
    throw error;
  }
}

/** How many temporary names this process has minted. */
let sequence = 0;

/**
 * A temporary name beside the file, unique to this write.
 *
 * Beside it rather than in the system temporary directory because `rename(2)`
 * is only atomic within one filesystem. The process id keeps two processes on
 * one site apart and the counter keeps two writes in one process apart, so a
 * failed write's leftovers can never be mistaken for another's.
 */
function temporaryName(file: string): string {
  sequence += 1;
  return `${file}.${process.pid.toString(36)}-${sequence.toString(36)}.tmp`;
}
