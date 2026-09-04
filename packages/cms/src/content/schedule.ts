import type { Document } from './document.ts';
import { dateSortKey } from './store.ts';
import type { ContentStore } from './store.ts';
import type { ChangeOrigin, DocumentChange } from './sync.ts';

/**
 * Whether a document's date is still ahead of the clock.
 *
 * This is the whole of scheduling: WordPress holds a post whose date is in the
 * future and publishes it on the date, and so does this. There is no
 * front-matter key and no column for it — a scheduled document is an ordinary
 * published one whose moment has not come, so the file stays the whole truth
 * and nothing has to be written when the moment does come.
 *
 * A document with no date, or one nobody can read, has nothing to wait for:
 * that is what keeps an undated page out of the rule without a second
 * predicate. The comparison is between two {@link dateSortKey} values, which
 * are UTC ISO strings, so it is the same comparison the index makes in SQL and
 * the two cannot disagree.
 */
export function isScheduled(document: Pick<Document, 'date'>, now: Date): boolean {
  const at = dateSortKey(document.date);
  return at !== null && at > now.toISOString();
}

/**
 * When a document becomes public, as the UTC instant the index sorts by, or
 * `undefined` when it is not waiting for anything.
 *
 * What the admin prints as "Scheduled for …".
 */
export function scheduledFor(document: Pick<Document, 'date'>, now: Date): string | undefined {
  return isScheduled(document, now) ? (dateSortKey(document.date) ?? undefined) : undefined;
}

/**
 * The origin a scheduled publish is announced under.
 *
 * It is its own origin so a subscriber that cares can tell a timer firing from
 * a file appearing, and so nothing has to infer it from a change where the
 * document did not move.
 */
export const SCHEDULE_ORIGIN: ChangeOrigin = 'schedule';

/**
 * `setTimeout` never sleeps longer than this: past 2^31-1 milliseconds the
 * delay overflows and the timer fires at once. A post dated years ahead is
 * therefore waited for in hops of at most 24 days, each one re-armed from the
 * index.
 */
export const MAXIMUM_DELAY_MS = 2_147_483_647;

/** Where the scheduler remembers how far it has got. */
export interface ScheduleWatermark {
  /**
   * The instant up to which due documents have been announced, or `undefined`
   * on a site that has never run a scheduler.
   */
  read(): string | undefined;
  /** Move it forward. */
  write(instant: string): void;
}

/**
 * The timer the scheduler waits on, injected so a test can fire it rather than
 * wait for it. The default is `setTimeout`, unreferenced so a pending publish
 * never holds the process open on its own.
 */
export interface ScheduleTimers {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

/** The real one. */
export const systemTimers: ScheduleTimers = {
  set(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    handle.unref?.();
    return handle;
  },
  clear(handle) {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

/** Where a scheduler reports what it could not do. `console` will do. */
export interface ScheduleLogger {
  warn(message: string): void;
}

/** What {@link createScheduler} needs. */
export interface CreateSchedulerOptions {
  /** The index, which answers what is due and when the next one is. */
  store: ContentStore;
  /** How a document that has come due is reported to every subscriber. */
  announce: (change: DocumentChange) => Promise<void>;
  /** How far the last run got, across restarts. */
  watermark: ScheduleWatermark;
  /** The timer to wait on. Defaults to {@link systemTimers}. */
  timers?: ScheduleTimers | undefined;
  /** Where failures are reported. Defaults to `console`. */
  logger?: ScheduleLogger | undefined;
}

/**
 * Publishes a document when its date arrives.
 *
 * A scheduled document is already indexed and already correct; the only thing
 * that changes when its moment comes is the clock, and nothing watches a
 * clock. So this holds one timer for the next document due, re-armed on every
 * index change, and when it fires it announces what has come due as the
 * publish it is — which is what makes the same delivery, the same feed ping
 * and the same `onPublish` hook run as for a post saved live.
 */
export interface Scheduler {
  /**
   * Catch up on anything that came due while nothing was running, then wait
   * for the next one. What `serve()` calls, after the boot scan.
   */
  start(): Promise<void>;
  /**
   * Announce everything that has come due since the last run and move the
   * watermark to now. Resolves with how many documents were published.
   *
   * A site with no watermark — a fresh install, or a database somebody
   * deleted — publishes nothing and simply starts from here: a rebuilt
   * database must not announce the archive all over again.
   */
  run(): Promise<number>;
  /** Consider one index change and re-arm the timer from it. */
  handle(change: DocumentChange): void;
  /** When the timer is set for, or `undefined` when nothing is waiting. */
  waitingFor(): string | undefined;
  /** Stop the timer. Safe before starting and safe twice. */
  stop(): void;
  /** Resolve once the run in flight, if there is one, has finished. */
  settled(): Promise<void>;
}

/**
 * Build the scheduler for one site.
 *
 * The watermark is what keeps a publish to exactly one announcement: a run
 * takes everything in `(watermark, now]` and then moves the watermark to
 * `now`, so a document that came due while the process was down is announced
 * on the next boot and never again — without asking whether it has been
 * delivered, which is a question only the federation could answer and which a
 * site with no followers could not answer at all.
 */
export function createScheduler(options: CreateSchedulerOptions): Scheduler {
  const { store, announce, watermark } = options;
  const timers = options.timers ?? systemTimers;
  const logger = options.logger ?? console;

  let handle: unknown;
  let waiting: string | undefined;
  let running: Promise<unknown> = Promise.resolve();

  /**
   * Announce one document that has come due.
   *
   * `previous` is `undefined` because no subscriber ever knew about it: the
   * public site did not serve it, the feeds did not list it and no follower
   * was told. Reported that way, a scheduled publish is the same change every
   * subscriber would have seen had the file been written at this moment — so
   * delivery sends one `Create`, the notifier pings the feeds and `onPublish`
   * fires, none of them knowing a timer was involved.
   */
  async function publish(document: Document): Promise<void> {
    await announce({
      type: 'created',
      path: document.path,
      previous: undefined,
      next: document,
      origin: SCHEDULE_ORIGIN,
    });
  }

  /** Wait for the next document due, or stop waiting when there is none. */
  function arm(): void {
    if (handle !== undefined) {
      timers.clear(handle);
      handle = undefined;
    }

    const due = store.nextDue();
    waiting = due;
    if (due === undefined) return;

    const delay = Math.min(
      MAXIMUM_DELAY_MS,
      Math.max(1, new Date(due).getTime() - store.now().getTime()),
    );
    handle = timers.set(() => {
      handle = undefined;
      // A hop rather than the whole wait: past the maximum delay the timer is
      // re-armed for the rest of it, and `run()` finds nothing due yet.
      running = fire();
    }, delay);
  }

  async function fire(): Promise<void> {
    try {
      await release();
    } catch (error) {
      logger.warn(`A scheduled publish failed: ${messageOf(error)}`);
    }
    arm();
  }

  async function release(): Promise<number> {
    const now = store.now().toISOString();
    const since = watermark.read();

    // Nothing to catch up on, because nothing has ever been watched. Start
    // from here rather than announcing an archive whose database was deleted.
    if (since === undefined) {
      watermark.write(now);
      return 0;
    }

    const due = store.listDueSince(since);
    // Before the announcements rather than after, so a subscriber that dies
    // half way through a catch-up cannot have the whole window announced to it
    // again on the next boot. A publish that fails is a line in the log; the
    // post is public either way, because being public is a property of its
    // date and not of anything this wrote down.
    watermark.write(now);

    let published = 0;
    for (const document of due) {
      try {
        await publish(document);
        published += 1;
      } catch (error) {
        logger.warn(`Could not announce ${document.path} as published: ${messageOf(error)}`);
      }
    }
    return published;
  }

  return {
    async start() {
      running = release();
      try {
        await running;
      } catch (error) {
        logger.warn(`The scheduled publishes could not be caught up: ${messageOf(error)}`);
      }
      arm();
    },

    async run() {
      const started = release();
      running = started;
      return await started;
    },

    handle() {
      // Every change is a reason to look again: a date moved, a post became a
      // draft, a file appeared. What is due next is one indexed lookup, so
      // asking after each change is cheaper than working out which changes
      // could have moved it.
      arm();
    },

    waitingFor() {
      return waiting;
    },

    stop() {
      if (handle !== undefined) timers.clear(handle);
      handle = undefined;
      waiting = undefined;
    },

    async settled() {
      await running.catch(ignore);
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ignore(): void {
  // A failed run is already logged; waiting for it must not throw.
}
