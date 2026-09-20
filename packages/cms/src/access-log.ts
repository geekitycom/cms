import type { MiddlewareHandler } from 'hono';

import { clientAddress } from './admin/throttle.ts';
import type { ResolvedConfig } from './config.ts';
import type { GeekityEnv } from './env.ts';

/**
 * Where one access-log line goes.
 *
 * The line arrives without a trailing newline; the sink decides the framing.
 * The default sink is stdout — what a container collects, what dockge shows
 * and what journald keeps — and a test hands in one that keeps the lines.
 */
export type AccessLogWriter = (line: string) => void;

/** What {@link createAccessLog} needs to know. */
export interface AccessLogOptions {
  /**
   * Whether a client address goes on the line, and which one is right. Read
   * once, at boot: the log is registered before the context is, so it cannot
   * read the config off a request.
   */
  config: Pick<ResolvedConfig, 'accessLogAddress' | 'trustProxy'>;
  /** Where the lines go. Defaults to stdout. */
  write?: AccessLogWriter;
}

/** The default sink: one write per line, the newline included, like the CLI's. */
function writeToStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * The path and query string of a request, taken out of its URL by hand.
 *
 * `new URL(...)` per request would parse and allocate the whole of an address
 * this only ever wants the tail of, and this runs on every request the site
 * answers. There is nothing to escape: Node's HTTP parser refuses a request
 * target with a control character in it, so whatever survives to here is one
 * line's worth of text.
 */
function requestTarget(url: string): string {
  const afterScheme = url.indexOf('://');
  const start = afterScheme < 0 ? -1 : url.indexOf('/', afterScheme + 3);
  return start < 0 ? '/' : url.slice(start);
}

/**
 * One line per request: what was asked, what was answered, and how long it
 * took.
 *
 * ```
 * GET /.well-known/webfinger?resource=acct:ada@example.com 200 3.1ms
 * ```
 *
 * The fields are in a fixed order and separated by spaces, so the status is
 * always the third and a line is readable by eye, by `grep` and by `awk`
 * alike. The client address, when the site asks for one, goes last for that
 * reason — turning it on moves nothing else.
 *
 * Only the request line is ever read: no body is touched, so nothing is
 * buffered and no password posted to the login form can reach the log, and no
 * header but the forwarded address a site has said to believe is looked at, so
 * no cookie and no `Authorization` can either. The query string is logged as
 * it arrived, because it is what a peer's WebFinger lookup carries and what a
 * question about who asked for what is answered with.
 */
export function createAccessLog(options: AccessLogOptions): MiddlewareHandler<GeekityEnv> {
  const write = options.write ?? writeToStdout;
  const { accessLogAddress, trustProxy } = options.config;

  return async function accessLog(c, next) {
    const started = performance.now();
    let threw = false;
    try {
      await next();
    } catch (error) {
      // A handler that threw has no response of its own: the error is on its
      // way up to Hono's error handler, which answers 500, and `c.res` would
      // hand back a freshly made 200 if asked. A request that failed is the
      // one most worth having a line for, so it gets the status it will be
      // answered with rather than the one it never had.
      threw = true;
      throw error;
    } finally {
      const elapsed = (performance.now() - started).toFixed(1);
      const status = threw ? 500 : c.res.status;
      let line = `${c.req.method} ${requestTarget(c.req.url)} ${String(status)} ${elapsed}ms`;
      if (accessLogAddress) {
        const address = clientAddress(c, { trustProxy });
        if (address !== undefined) line += ` ${address}`;
      }
      write(line);
    }
  };
}
