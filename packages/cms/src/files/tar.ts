import { gunzipSync } from 'node:zlib';

/**
 * A ustar archive, written one entry at a time and read whole. A name that
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

/** Two zero blocks: the end of an archive. */
export const TAR_END: Buffer = Buffer.alloc(BLOCK * 2);

/** The zero bytes that fill an entry of `size` bytes out to a block. */
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
  block.write(' '.repeat(8), 148, 'ascii');
  block.write(fields.type, 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
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

/** The header blocks of one regular file, with a PAX header first when it needs one. */
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

/** Every entry of a gzipped tar, in order, with PAX and GNU long names applied. */
export function readTar(gzipped: Buffer): TarEntry[] {
  const archive = gunzipSync(gzipped);
  const entries: TarEntry[] = [];
  let pax = new Map<string, string>();
  let longName: string | undefined;
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    const block = archive.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) break;
    const flag = String.fromCharCode(block[156] ?? 0);
    const size = Number(pax.get('size') ?? Number.parseInt(field(block, 124, 12).trim() || '0', 8));
    const body = archive.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (flag === 'x') {
      pax = paxValues(body.toString('utf8'));
      continue;
    }
    if (flag === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    const prefix = field(block, 345, 155);
    const name =
      pax.get('path') ?? longName ?? (prefix === '' ? '' : `${prefix}/`) + field(block, 0, 100);
    entries.push({
      name,
      type: typeOf(flag),
      mode: Number.parseInt(field(block, 100, 8).trim() || '0', 8),
      body: Buffer.from(body),
    });
    pax = new Map();
    longName = undefined;
  }
  return entries;
}
