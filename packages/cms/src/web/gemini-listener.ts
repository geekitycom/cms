/**
 * The gemini:// listener (decision-60, TASK-484): a TLS server that reads one
 * request line per connection, asks the site's own app for the gemtext HTTP
 * serves at the same place, and answers with the Gemini status for what the
 * app said. One rendering path serves both protocols, so a page, a redirect
 * or a status cannot read differently over Gemini than at its `.gmi` URL.
 */

import tls from 'node:tls';
import type { TLSSocket } from 'node:tls';

import type { Clock } from '../util/clock.ts';
import { accessLine } from './access-line.ts';
import { headerFor, readRequestLine, routeRequest } from './gemini-request.ts';
import type { GeminiHeader } from './gemini-request.ts';
import { createRequestLimit } from './throttle.ts';

/** Per client address: about one a second, which a reader never reaches and a crawler can keep to. */
const DEFAULT_LIMIT = { requests: 60, windowSeconds: 60 };
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;

export interface GeminiListenerOptions {
  /** 0 for any free port. */
  readonly port: number;
  /** PEM. */
  readonly certificate: { readonly cert: string; readonly key: string };
  /** The host the capsule answers for, and the HTTP origin its pages are asked of. Read per request. */
  site(): Promise<{ readonly host: string; readonly origin: string }>;
  /** The site's app. */
  fetch(request: Request): Promise<Response>;
  /** Where the access log goes, and whether its lines carry the client address; `undefined` logs nothing. */
  readonly log: { readonly write: (line: string) => void; readonly address: boolean } | undefined;
  readonly now: Clock;
  readonly limit?: { readonly requests: number; readonly windowSeconds: number };
  readonly requestTimeoutMs?: number;
}

export interface GeminiListener {
  /** The port bound, which matters when it was asked for as 0. */
  readonly port: number;
  /** Stop accepting, and resolve once every connection has been answered. Safe to call twice. */
  close(): Promise<void>;
}

export async function listenForGemini(options: GeminiListenerOptions): Promise<GeminiListener> {
  const limit = createRequestLimit({ ...(options.limit ?? DEFAULT_LIMIT), now: options.now });
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  /**
   * One connection from `address`. The address is handed in rather than read
   * here, so a listener behind a proxy can give the one its PROXY header names.
   */
  async function answer(socket: TLSSocket, address: string | undefined): Promise<void> {
    const started = performance.now();
    let target = '-';
    const respond = async (header: GeminiHeader, body?: ReadableStream<Uint8Array> | null) => {
      options.log?.write(
        accessLine(
          'GEMINI',
          target,
          header.status,
          started,
          options.log.address ? address : undefined,
        ),
      );
      if (socket.destroyed) return;
      socket.write(`${String(header.status)} ${header.meta}\r\n`);
      if (body) {
        for await (const chunk of body) {
          if (socket.destroyed) return;
          if (!socket.write(chunk)) await new Promise((resolve) => socket.once('drain', resolve));
        }
      }
      // Read on to the client's close_notify, which a socket never read from never sees.
      socket.resume();
      socket.end();
    };

    const wait = address === undefined ? undefined : limit.take(address);
    if (wait !== undefined) {
      await respond({ status: 44, meta: String(wait) });
      return;
    }

    const read = await readRequest(socket, timeoutMs);
    if ('header' in read) {
      await respond(read.header);
      return;
    }
    const site = await options.site();
    target = targetOf(read.line);
    const route = routeRequest(read.line, site.host);
    if ('header' in route) {
      await respond(route.header);
      return;
    }
    const ask = (path: string) =>
      options.fetch(
        new Request(new URL(path, site.origin), { headers: { accept: 'text/gemini' } }),
      );
    const [first, ...rest] = route.paths;
    let response = await ask(first);
    for (const path of rest) {
      if (response.status !== 404) break;
      await response.body?.cancel();
      response = await ask(path);
    }
    const header = headerFor(response, site.origin);
    if (header.status === 20) {
      await respond(header, response.body);
    } else {
      await response.body?.cancel();
      await respond(header);
    }
  }

  const server = tls.createServer(
    {
      cert: options.certificate.cert,
      key: options.certificate.key,
      minVersion: 'TLSv1.2',
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
    },
    (socket) => {
      socket.on('error', () => undefined);
      socket.setTimeout(timeoutMs * 3, () => socket.destroy());
      answer(socket, socket.remoteAddress).catch((error: unknown) => {
        console.error('A Gemini request failed:', error);
        if (!socket.destroyed) socket.end('40 Something went wrong\r\n');
      });
    },
  );
  server.on('tlsClientError', () => undefined);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;

  let closing: Promise<void> | undefined;
  return {
    port,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return closing;
    },
  };
}

/** The request line as far as it has come, a header to answer at once, or a 59 when time runs out. */
function readRequest(
  socket: TLSSocket,
  timeoutMs: number,
): Promise<{ readonly line: string } | { readonly header: GeminiHeader }> {
  return new Promise((resolve) => {
    let received = Buffer.alloc(0);
    const finish = (result: { line: string } | { header: GeminiHeader }) => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('end', onEnd);
      resolve(result);
    };
    const onData = (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const read = readRequestLine(received);
      if (read !== undefined) finish(read);
    };
    const onEnd = () => finish({ header: { status: 59, meta: 'The request ended without CR LF' } });
    const timer = setTimeout(() => {
      finish({ header: { status: 59, meta: 'The request did not arrive in time' } });
    }, timeoutMs);
    socket.on('data', onData);
    socket.on('end', onEnd);
  });
}

/** The path and query a request asked for, for the log. */
function targetOf(line: string): string {
  try {
    const url = new URL(line);
    return `${url.pathname === '' ? '/' : url.pathname}${url.search}`;
  } catch {
    return '-';
  }
}
