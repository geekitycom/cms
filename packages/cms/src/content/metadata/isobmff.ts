import { ascii, fourcc, sameBytes, UnreadableMetadataError, view } from './shared.ts';
import type { Stripped } from './shared.ts';

/** One box of an ISO base media file: where it starts, where its body starts, where it ends. */
interface Box {
  type: string;
  start: number;
  body: number;
  end: number;
}

/**
 * The boxes laid end to end between `start` and `end`. A box whose size runs
 * past `end` is taken as cut short there, and a size of zero runs to `end`,
 * as the format says.
 */
function boxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const data = view(bytes);
  const found: Box[] = [];
  for (let at = start; at + 8 <= end;) {
    let size = data.getUint32(at);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = Number(data.getBigUint64(at + 8));
      body = at + 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < body - at) break;
    const boxEnd = Math.min(end, at + size);
    found.push({ type: fourcc(bytes, at + 4), start: at, body, end: boxEnd });
    at = boxEnd;
  }
  return found;
}

/** Boxes a movie keeps its tracks and their media in, which metadata can sit inside. */
const MOVIE_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf']);

const MOVIE_LABELS: Readonly<Record<string, string>> = {
  udta: 'user data (location, camera)',
  meta: 'metadata (location, camera)',
  uuid: 'XMP',
  XMP_: 'XMP',
};

/**
 * An MP4 or M4V with every user-data, metadata and uuid box in the movie, its
 * tracks and the top level emptied in place: the box becomes a `free` box of
 * the same size, zero-filled. That is where a phone writes the place a video
 * was shot (`©xyz`, the QuickTime location key) and where XMP goes, and none
 * of it is needed to play the file. Nothing moves, so every chunk offset in
 * the sample tables still points at the same media data, whichever end of the
 * file the movie box is at.
 */
export function stripMovie(bytes: Uint8Array): Stripped {
  const out = Uint8Array.from(bytes);
  const removed: string[] = [];

  const walk = (start: number, end: number): void => {
    for (const box of boxes(bytes, start, end)) {
      const label = MOVIE_LABELS[box.type];
      if (label !== undefined) {
        out.set(ascii('free'), box.start + 4);
        out.fill(0, box.body, box.end);
        removed.push(label);
      } else if (MOVIE_CONTAINERS.has(box.type)) {
        walk(box.body, box.end);
      }
    }
  };
  walk(0, bytes.length);

  return removed.length === 0 ? { bytes, removed } : { bytes: out, removed: [...new Set(removed)] };
}

/** An EXIF payload with nothing in it: a zero TIFF-header offset and a TIFF with an empty IFD. */
const EMPTY_EXIF = Uint8Array.from([
  0, 0, 0, 0, 0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0,
]);

/** An XMP packet with nothing in it; padding goes between the two halves, as XMP allows. */
const EMPTY_XMP_HEAD = ascii(
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/>',
);
const EMPTY_XMP_TAIL = ascii('<?xpacket end="w"?>');

/** The bytes an item of this length is overwritten with, so it holds nothing and still parses. */
function blankPayload(kind: 'EXIF' | 'XMP', length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (kind === 'EXIF') {
    if (length >= EMPTY_EXIF.length) out.set(EMPTY_EXIF);
    return out;
  }
  out.fill(0x20);
  if (length >= EMPTY_XMP_HEAD.length + EMPTY_XMP_TAIL.length) {
    out.set(EMPTY_XMP_HEAD);
    out.set(EMPTY_XMP_TAIL, length - EMPTY_XMP_TAIL.length);
  }
  return out;
}

/**
 * An AVIF whose Exif and XMP items are overwritten in place with an empty
 * EXIF block and an empty, padded XMP packet of the same length.
 *
 * The items stay listed, so no box changes size and no item location needs
 * rewriting; what they hold is gone. The picture's own orientation lives in
 * its `irot` and `imir` properties, which are not metadata items and are left
 * alone. The pixels are not touched, so nothing is re-encoded.
 */
export function stripAvif(bytes: Uint8Array): Stripped {
  const fail = (problem: string): never => {
    throw new UnreadableMetadataError('AVIF', problem);
  };
  const meta = boxes(bytes, 0, bytes.length).find((box) => box.type === 'meta');
  if (meta === undefined) return { bytes, removed: [] };

  // `meta` is a full box: a version and flags before its children.
  const children = boxes(bytes, meta.body + 4, meta.end);
  const iinf = children.find((box) => box.type === 'iinf');
  const iloc = children.find((box) => box.type === 'iloc');
  const idat = children.find((box) => box.type === 'idat');
  if (iinf === undefined || iloc === undefined) return { bytes, removed: [] };

  const data = view(bytes);
  const read = (at: number, size: number, limit: number): number => {
    if (at + size > limit) fail('an item table runs past its box');
    if (size === 0) return 0;
    if (size === 2) return data.getUint16(at);
    if (size === 4) return data.getUint32(at);
    if (size === 8) return Number(data.getBigUint64(at));
    return fail(`a field of ${String(size)} bytes`);
  };

  const metadataItems = new Map<number, 'EXIF' | 'XMP'>();
  const iinfVersion = bytes[iinf.body] ?? 0;
  const entriesAt = iinf.body + 4 + (iinfVersion === 0 ? 2 : 4);
  for (const infe of boxes(bytes, entriesAt, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const version = bytes[infe.body] ?? 0;
    if (version < 2) continue;
    const idSize = version === 2 ? 2 : 4;
    const id = read(infe.body + 4, idSize, infe.end);
    const typeAt = infe.body + 4 + idSize + 2;
    if (typeAt + 4 > infe.end) fail('an item entry is cut short');
    const itemType = fourcc(bytes, typeAt);
    if (itemType === 'Exif') {
      metadataItems.set(id, 'EXIF');
    } else if (itemType === 'mime') {
      const strings = Buffer.from(bytes.subarray(typeAt + 4, infe.end)).toString('latin1');
      const contentType = strings.split('\0')[1] ?? '';
      if (contentType.trim().toLowerCase() === 'application/rdf+xml') metadataItems.set(id, 'XMP');
    }
  }
  if (metadataItems.size === 0) return { bytes, removed: [] };

  const out = Uint8Array.from(bytes);
  const removed: string[] = [];
  const version = bytes[iloc.body] ?? 0;
  let at = iloc.body + 4;
  const sizes = read(at, 2, iloc.end);
  const offsetSize = sizes >> 12;
  const lengthSize = (sizes >> 8) & 0xf;
  const baseOffsetSize = (sizes >> 4) & 0xf;
  const indexSize = version === 0 ? 0 : sizes & 0xf;
  at += 2;
  const itemCount = read(at, version < 2 ? 2 : 4, iloc.end);
  at += version < 2 ? 2 : 4;

  for (let item = 0; item < itemCount; item += 1) {
    const id = read(at, version < 2 ? 2 : 4, iloc.end);
    at += version < 2 ? 2 : 4;
    let method = 0;
    if (version > 0) {
      method = read(at, 2, iloc.end) & 0xf;
      at += 2;
    }
    at += 2; // data_reference_index
    const base = read(at, baseOffsetSize, iloc.end);
    at += baseOffsetSize;
    const extentCount = read(at, 2, iloc.end);
    at += 2;
    const extents: [number, number][] = [];
    for (let extent = 0; extent < extentCount; extent += 1) {
      at += indexSize;
      const offset = read(at, offsetSize, iloc.end);
      at += offsetSize;
      const length = read(at, lengthSize, iloc.end);
      at += lengthSize;
      extents.push([offset, length]);
    }

    const kind = metadataItems.get(id);
    if (kind === undefined) continue;
    if (method === 1 && idat === undefined) fail('an item points into an idat that is not there');
    if (method > 1) fail('an item is built from other items');
    const origin = method === 1 ? (idat as Box).body : 0;
    const limit = method === 1 ? (idat as Box).end : bytes.length;
    const ranges = extents.map(([offset, length]): [number, number] => {
      const start = origin + base + offset;
      const end = length === 0 ? limit : start + length;
      if (end > limit) fail('an item runs past the end');
      return [start, end];
    });

    const total = ranges.reduce((sum, [start, end]) => sum + end - start, 0);
    const blank = blankPayload(kind, total);
    let written = 0;
    let changed = false;
    for (const [start, end] of ranges) {
      const part = blank.subarray(written, written + end - start);
      if (!sameBytes(part, bytes.subarray(start, end))) changed = true;
      out.set(part, start);
      written += end - start;
    }
    if (changed) removed.push(kind);
  }

  return removed.length === 0 ? { bytes, removed } : { bytes: out, removed: [...new Set(removed)] };
}
