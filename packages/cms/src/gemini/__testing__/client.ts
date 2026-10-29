import net from 'node:net';
import tls from 'node:tls';

export interface GeminiAnswer {
  readonly status: number;
  readonly meta: string;
  readonly body: Buffer;
  readonly closedCleanly: boolean;
  readonly fingerprint256: string;
}

export async function geminiRequest(
  port: number,
  request: string | Buffer,
  servername = 'example.com',
  preamble?: Buffer,
): Promise<GeminiAnswer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let fingerprint256 = '';
    const raw = net.connect(port, '127.0.0.1');
    raw.on('error', reject);
    if (preamble !== undefined) raw.write(preamble);
    const socket = tls.connect({ socket: raw, servername, rejectUnauthorized: false }, () => {
      fingerprint256 = socket.getPeerCertificate().fingerprint256;
      socket.write(request);
    });
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

export async function gemini(port: number, path: string): Promise<GeminiAnswer> {
  return await geminiRequest(port, `gemini://example.com${path}\r\n`);
}

export function proxyV2(
  options: { readonly address?: string; readonly local?: boolean; readonly tlv?: Buffer } = {},
): Buffer {
  const signature = Buffer.from('0d0a0d0a000d0a515549540a', 'hex');
  const six = options.address?.includes(':') === true;
  const addresses =
    options.address === undefined
      ? Buffer.alloc(0)
      : Buffer.concat([
          six ? ipv6Bytes(options.address) : Buffer.from(options.address.split('.').map(Number)),
          six ? ipv6Bytes('2001:db8::1') : Buffer.from([192, 0, 2, 1]),
          Buffer.from([0xc7, 0x38, 0x07, 0xad]),
        ]);
  const body = Buffer.concat([addresses, options.tlv ?? Buffer.alloc(0)]);
  const head = Buffer.alloc(4);
  head[0] = options.local === true ? 0x20 : 0x21;
  head[1] = options.address === undefined ? 0x00 : six ? 0x21 : 0x11;
  head.writeUInt16BE(body.length, 2);
  return Buffer.concat([signature, head, body]);
}

function ipv6Bytes(address: string): Buffer {
  const [left = '', right = ''] = address.split('::');
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const head = groups(left);
  const tail = groups(right);
  const all = [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail];
  const bytes = Buffer.alloc(16);
  all.forEach((group, index) => bytes.writeUInt16BE(Number.parseInt(group, 16), index * 2));
  return bytes;
}

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
