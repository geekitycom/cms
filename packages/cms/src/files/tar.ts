import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

/**
 * A ustar archive, written one entry at a time, and read whole or as a stream. A name that
 * does not fit the header's 100 bytes, or is not ASCII, and a size past the
 * header's octal field, travel in a PAX extended header before the entry, as
 * GNU and BSD tar read them.
 */

const BLOCK = 512;
const NAME_BYTES = 100;
const SIZE_LIMIT = 8 ** 11;

export interface TarFile {
  readonly name: string;
  readonly mode: number;
  readonly size: number;
  readonly mtime: Date;
}

export type TarEntryType = 'file' | 'directory' | 'link' | 'other';

export interface TarEntry {
  readonly name: string;
  readonly type: TarEntryType;
  readonly mode: number;
  readonly body: Buffer;
}

export interface TarStreamEntry {
  readonly name: string;
  readonly type: TarEntryType;
  readonly mode: number;
  readonly size: number;
  readonly mtime: Date;
  /** The entry's bytes. Whatever is left unread is skipped when the next entry is asked for. */
  readonly body: AsyncIterable<Buffer>;
}

export const TAR_END: Buffer = Buffer.alloc(BLOCK * 2);

export function tarPadding(size: number): Buffer {
  return Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function header(fields: {
  name: string;
  mode: number;
  size: number;
  mtime: number;
  type: string;
}): Buffer {
  const block = Buffer.alloc(BLOCK);
  block.write(fields.name, 0, NAME_BYTES, 'utf8');
  block.write(octal(fields.mode & 0o7777, 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(fields.size, 12), 124, 'ascii');
  block.write(octal(fields.mtime, 12), 136, 'ascii');
  block.write(fields.type, 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  return sealHeader(block);
}

export function sealHeader(block: Buffer): Buffer {
  block.write(' '.repeat(8), 148, 'ascii');
  const sum = block.reduce((total, byte) => total + byte, 0);
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
}

function paxRecord(key: string, value: string): string {
  const text = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(text) + 1;
  while (String(length).length + Buffer.byteLength(text) !== length) {
    length = String(length).length + Buffer.byteLength(text);
  }
  return `${String(length)}${text}`;
}

export function tarHeader(file: TarFile): Buffer {
  const mtime = Math.floor(file.mtime.getTime() / 1000);
  const fitsName = /^[\x20-\x7e]*$/.test(file.name) && file.name.length <= NAME_BYTES;
  const fitsSize = file.size < SIZE_LIMIT;
  const plain = header({
    name: fitsName ? file.name : file.name.slice(0, NAME_BYTES).replace(/[^\x20-\x7e]/g, '_'),
    mode: file.mode,
    size: fitsSize ? file.size : 0,
    mtime,
    type: '0',
  });
  if (fitsName && fitsSize) return plain;
  const records = Buffer.from(
    (fitsName ? '' : paxRecord('path', file.name)) +
      (fitsSize ? '' : paxRecord('size', String(file.size))),
  );
  return Buffer.concat([
    header({ name: 'PaxHeader', mode: 0o644, size: records.length, mtime, type: 'x' }),
    records,
    tarPadding(records.length),
    plain,
  ]);
}

function field(block: Buffer, start: number, length: number): string {
  return block
    .subarray(start, start + length)
    .toString('utf8')
    .replace(/\0.*$/s, '');
}

function paxValues(records: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const record of records.split('\n')) {
    const match = /^\d+ ([^=]+)=(.*)$/s.exec(record);
    if (match?.[1] !== undefined && match[2] !== undefined) values.set(match[1], match[2]);
  }
  return values;
}

function typeOf(flag: string): TarEntryType {
  if (flag === '0' || flag === '\0') return 'file';
  if (flag === '5') return 'directory';
  if (flag === '1' || flag === '2') return 'link';
  return 'other';
}

const EXTENDED_HEADER_LIMIT = 1024 * 1024;

function cutShort(): Error {
  return new Error('The archive is cut short: it ends inside an entry.');
}

class ByteReader {
  readonly #chunks: AsyncIterator<Buffer>;
  #held: Buffer = Buffer.alloc(0);

  constructor(chunks: AsyncIterable<Buffer>) {
    this.#chunks = chunks[Symbol.asyncIterator]();
  }

  async #more(): Promise<boolean> {
    const next = await this.#chunks.next();
    if (next.done === true) return false;
    this.#held = this.#held.length === 0 ? next.value : Buffer.concat([this.#held, next.value]);
    return true;
  }

  async exactly(count: number): Promise<Buffer | undefined> {
    while (this.#held.length < count) {
      if (!(await this.#more())) {
        if (this.#held.length === 0) return undefined;
        throw cutShort();
      }
    }
    const taken = this.#held.subarray(0, count);
    this.#held = this.#held.subarray(count);
    return taken;
  }

  async piece(most: number): Promise<Buffer> {
    if (this.#held.length === 0 && !(await this.#more())) throw cutShort();
    const taken = this.#held.subarray(0, Math.min(most, this.#held.length));
    this.#held = this.#held.subarray(taken.length);
    return taken;
  }
}

export async function* readTarStream(
  gzipped: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): AsyncGenerator<TarStreamEntry> {
  const gunzip = createGunzip();
  pipeline(gzipped, gunzip).catch(() => undefined);
  const reader = new ByteReader(gunzip);
  let pax = new Map<string, string>();
  let longName: string | undefined;
  try {
    for (;;) {
      const block = await reader.exactly(BLOCK);
      if (block === undefined || block.every((byte) => byte === 0)) return;
      const flag = String.fromCharCode(block[156] ?? 0);
      const size = Number(
        pax.get('size') ?? Number.parseInt(field(block, 124, 12).trim() || '0', 8),
      );
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error('The archive holds an entry with a size that is not a whole number.');
      }
      const padding = tarPadding(size).length;

      if (flag === 'x' || flag === 'L') {
        if (size > EXTENDED_HEADER_LIMIT) throw new Error('The archive holds an oversized header.');
        const body = (await reader.exactly(size + padding)) ?? Buffer.alloc(0);
        if (body.length < size) throw cutShort();
        const text = body.subarray(0, size).toString('utf8');
        if (flag === 'x') pax = paxValues(text);
        else longName = text.replace(/\0.*$/s, '');
        continue;
      }

      const prefix = field(block, 345, 155);
      const name =
        pax.get('path') ?? longName ?? (prefix === '' ? '' : `${prefix}/`) + field(block, 0, 100);
      const seconds = Number(
        pax.get('mtime') ?? Number.parseInt(field(block, 136, 12).trim() || '0', 8),
      );
      pax = new Map();
      longName = undefined;

      let left = size;
      yield {
        name,
        type: typeOf(flag),
        mode: Number.parseInt(field(block, 100, 8).trim() || '0', 8),
        size,
        mtime: new Date(Math.floor(seconds * 1000)),
        body: {
          async *[Symbol.asyncIterator]() {
            while (left > 0) {
              const piece = await reader.piece(left);
              left -= piece.length;
              yield piece;
            }
          },
        },
      };
      while (left > 0) left -= (await reader.piece(left)).length;
      if (padding > 0 && (await reader.exactly(padding)) === undefined) throw cutShort();
    }
  } finally {
    gunzip.destroy();
  }
}

export async function readTar(gzipped: Buffer): Promise<TarEntry[]> {
  const entries: TarEntry[] = [];
  for await (const entry of readTarStream([gzipped])) {
    const pieces: Buffer[] = [];
    for await (const piece of entry.body) pieces.push(piece);
    entries.push({
      name: entry.name,
      type: entry.type,
      mode: entry.mode,
      body: Buffer.concat(pieces),
    });
  }
  return entries;
}
