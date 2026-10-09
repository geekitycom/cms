/**
 * The write gate a CMS closes when it hands over to a new worker under
 * `geekity serve` (TASK-288, decision-33).
 *
 * While it is closed, a request that is not GET or HEAD is answered 503 with
 * `Retry-After`, and a GET that tries to write once the worker has gone
 * read-only is answered the same way, so a reader retries against the new
 * worker rather than seeing a 500. Every response then carries
 * `Connection: close`: the client's next request opens a new connection,
 * which the supervisor hands to whichever worker is listening.
 */

import type { Context, MiddlewareHandler } from 'hono';

import type { GeekityEnv } from './env.ts';
import { WritesRefusedError } from './files/atomic.ts';

/** How long a refused client is asked to wait: about as long as a worker takes to boot. */
export const DRAIN_RETRY_AFTER_SECONDS = 5;

/**
 * The longest a drain waits for the writes in flight. An editor action can
 * hold a request open on a model for 60 seconds (plugin-llm's timeout), and
 * it should finish; one that is still going after this is cut off by the
 * read-only switch.
 */
const WRITE_WAIT_MS = 75_000;

/** SQLite's result code for a write on a `query_only` connection. */
const SQLITE_READONLY = 8;

export interface WriteGate {
  readonly refusing: boolean;
  readonly middleware: MiddlewareHandler<GeekityEnv>;
  /** Refuse new writes, and resolve once those in flight have finished. */
  refuse(): Promise<void>;
  reopen(): void;
  /** Stop counting a request as a write in flight, so the drain it is about to wait on does not wait on it. */
  leave(request: object): void;
  /**
   * The new worker serves: answer a GET or HEAD that still reaches this one,
   * on a keep-alive connection, with a redirect to the same URL on a new
   * connection, which the new worker takes.
   */
  handOver(): void;
}

export function createWriteGate(options: { waitMs?: number } = {}): WriteGate {
  let refusing = false;
  let handedOver = false;
  let inFlight = 0;
  let idle: (() => void)[] = [];
  const counted = new WeakSet<object>();

  function finished(): void {
    inFlight -= 1;
    if (inFlight > 0) return;
    const waiting = idle;
    idle = [];
    for (const wake of waiting) wake();
  }

  const middleware: MiddlewareHandler<GeekityEnv> = async (c, next) => {
    const writing = c.req.method !== 'GET' && c.req.method !== 'HEAD';

    if (refusing) {
      if (writing) return refusal(c);
      if (handedOver) return sentOn(c);
      await next();
      if (c.error !== undefined && isRefusedWrite(c.error)) {
        c.res = refusal(c);
        return;
      }
      closeConnection(c);
      return;
    }

    if (!writing) {
      await next();
      return;
    }
    inFlight += 1;
    counted.add(c);
    try {
      await next();
    } finally {
      if (counted.delete(c)) finished();
    }
  };

  return {
    get refusing() {
      return refusing;
    },
    middleware,

    async refuse() {
      refusing = true;
      if (inFlight === 0) return;
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        new Promise<void>((resolve) => idle.push(resolve)),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, options.waitMs ?? WRITE_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
    },

    reopen() {
      refusing = false;
    },

    leave(request) {
      if (counted.delete(request)) finished();
    },

    handOver() {
      handedOver = true;
    },
  };
}

function refusal(c: Context<GeekityEnv>): Response {
  return c.text('This site is reloading. Try again in a few seconds.', 503, {
    'Retry-After': String(DRAIN_RETRY_AFTER_SECONDS),
    Connection: 'close',
    'Cache-Control': 'no-store',
  });
}

function sentOn(c: Context<GeekityEnv>): Response {
  const { pathname, search } = new URL(c.req.url);
  return c.body(null, 307, {
    Location: `${pathname}${search}`,
    Connection: 'close',
    'Cache-Control': 'no-store',
  });
}

function closeConnection(c: Context<GeekityEnv>): void {
  try {
    c.res.headers.set('Connection', 'close');
  } catch {
    // A response passed through from `fetch` has immutable headers.
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set('Connection', 'close');
  }
}

function isRefusedWrite(error: Error): boolean {
  return (
    error instanceof WritesRefusedError ||
    (error as { errcode?: unknown }).errcode === SQLITE_READONLY
  );
}
