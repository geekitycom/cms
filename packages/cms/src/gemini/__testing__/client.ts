import net from 'node:net';
import tls from 'node:tls';

/** One Gemini response as a client reads it. */
export interface GeminiAnswer {
  readonly status: number;
  readonly meta: string;
  readonly body: Buffer;
  /** Whether the server ended the TLS session with close_notify rather than a reset. */
  readonly closedCleanly: boolean;
  readonly fingerprint256: string;
}

/**
 * Send `request` as it is (add the CRLF yourself) over a real TLS connection
 * and read until the server closes.
 */
export async function geminiRequest(
  port: number,
  request: string | Buffer,
  servername = 'example.com',
): Promise<GeminiAnswer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let fingerprint256 = '';
    const socket = tls.connect(
      { host: '127.0.0.1', port, servername, rejectUnauthorized: false },
      () => {
        fingerprint256 = socket.getPeerCertificate().fingerprint256;
        socket.write(request);
      },
    );
    let ended = false;
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('end', () => {
      ended = true;
    });
    socket.on('error', reject);
    socket.on('close', () => {
      const all = Buffer.concat(chunks);
      const end = all.indexOf('\r\n');
      const header = all.subarray(0, end < 0 ? all.length : end).toString('utf8');
      const [, status = '', meta = ''] = /^(\d\d)(?: (.*))?$/.exec(header) ?? [];
      resolve({
        status: Number(status),
        meta,
        body: end < 0 ? Buffer.alloc(0) : all.subarray(end + 2),
        closedCleanly: ended,
        fingerprint256,
      });
    });
  });
}

/** `gemini://example.com<path>` and its CRLF, the usual request. */
export async function gemini(port: number, path: string): Promise<GeminiAnswer> {
  return await geminiRequest(port, `gemini://example.com${path}\r\n`);
}

/** Whether anything accepts a TCP connection on the port. */
export async function refuses(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

/** A port nothing listens on just now. */
export async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (typeof address !== 'object' || address === null) throw new Error('no port');
  return address.port;
}
