import net from 'node:net';
import tls from 'node:tls';
import type { TLSSocket } from 'node:tls';

import type { Clock } from '../util/clock.ts';
import { accessLine } from './access-line.ts';
import { headerFor, readRequestLine, routeRequest } from './gemini-request.ts';
import type { GeminiHeader } from './gemini-request.ts';
import { readProxyPreamble } from './proxy-protocol.ts';
import { createRequestLimit } from './throttle.ts';

const DEFAULT_LIMIT = { requests: 60, windowSeconds: 60 };
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;

export interface GeminiListenerOptions {
  readonly port: number;
  readonly certificate: { readonly cert: string; readonly key: string };
  site(): Promise<{ readonly host: string; readonly origin: string }>;
  fetch(request: Request): Promise<Response>;
  readonly log: { readonly write: (line: string) => void; readonly address: boolean } | undefined;
  readonly now: Clock;
  acceptsProxyHeaderFrom(peer: string): boolean;
  readonly limit?: { readonly requests: number; readonly windowSeconds: number };
  readonly requestTimeoutMs?: number;
}

export interface GeminiListener {
  readonly port: number;
  close(): Promise<void>;
}

export async function listenForGemini(options: GeminiListenerOptions): Promise<GeminiListener> {
  const limit = createRequestLimit({ ...(options.limit ?? DEFAULT_LIMIT), now: options.now });
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

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

  const secureContext = tls.createSecureContext({
    cert: options.certificate.cert,
    key: options.certificate.key,
    minVersion: 'TLSv1.2',
  });
  const server = net.createServer((raw) => {
    raw.on('error', () => undefined);
    void readPreamble(raw, timeoutMs).then((preamble) => {
      const peer = raw.remoteAddress;
      if (
        preamble === undefined ||
        (preamble.proxied && (peer === undefined || !options.acceptsProxyHeaderFrom(peer)))
      ) {
        raw.destroy();
        return;
      }
      const socket = new tls.TLSSocket(raw, { isServer: true, secureContext });
      socket.on('error', () => undefined);
      const handshake = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
      socket.once('secure', () => clearTimeout(handshake));
      socket.once('close', () => clearTimeout(handshake));
      socket.setTimeout(timeoutMs * 3, () => socket.destroy());
      answer(socket, preamble.address ?? peer).catch((error: unknown) => {
        console.error('A Gemini request failed:', error);
        if (!socket.destroyed) socket.end('40 Something went wrong\r\n');
      });
    });
  });

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

function readPreamble(
  raw: net.Socket,
  timeoutMs: number,
): Promise<{ readonly proxied: boolean; readonly address: string | undefined } | undefined> {
  return new Promise((resolve) => {
    let received = Buffer.alloc(0);
    const finish = (
      result: { proxied: boolean; address: string | undefined } | undefined,
      rest?: Buffer,
    ) => {
      clearTimeout(timer);
      raw.off('data', onData);
      raw.off('end', onEnd);
      raw.pause();
      if (rest !== undefined && rest.length > 0) raw.unshift(rest);
      resolve(result);
    };
    const onData = (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const preamble = readProxyPreamble(received);
      switch (preamble.kind) {
        case 'partial':
          return;
        case 'none':
          finish({ proxied: false, address: undefined }, received);
          return;
        case 'invalid':
          finish(undefined);
          return;
        case 'header':
          finish({ proxied: true, address: preamble.address }, received.subarray(preamble.length));
      }
    };
    const onEnd = () => finish(undefined);
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    raw.on('data', onData);
    raw.on('end', onEnd);
  });
}

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

function targetOf(line: string): string {
  try {
    const url = new URL(line);
    return `${url.pathname === '' ? '/' : url.pathname}${url.search}`;
  } catch {
    return '-';
  }
}
