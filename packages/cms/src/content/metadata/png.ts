import { crc32 } from 'node:zlib';

import { ascii, concat, fourcc, sameBytes, stripped, view } from './shared.ts';
import type { Stripped } from './shared.ts';
import { keptExif } from './tiff.ts';

/** Critical chunks are kept too, outside this set: a decoder must refuse a file missing one. */
const RENDERING = new Set([
  'tRNS',
  'cHRM',
  'gAMA',
  'iCCP',
  'sBIT',
  'sRGB',
  'cICP',
  'mDCV',
  'cLLI',
  'bKGD',
  'hIST',
  'pHYs',
  'sPLT',
  'acTL',
  'fcTL',
  'fdAT',
]);

const LABELS: Readonly<Record<string, string>> = {
  eXIf: 'EXIF',
  tEXt: 'text',
  zTXt: 'text',
  iTXt: 'text',
  tIME: 'timestamp',
};

export function stripPng(bytes: Uint8Array): Stripped {
  const data = view(bytes);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const removed: string[] = [];

  for (let at = 8; at < bytes.length;) {
    if (at + 8 > bytes.length) {
      parts.push(bytes.subarray(at));
      break;
    }
    const type = fourcc(bytes, at + 4);
    const end = Math.min(bytes.length, at + 12 + data.getUint32(at));
    const critical = ((bytes[at + 4] as number) & 0x20) === 0;

    if (type === 'eXIf') {
      const tiff = keptExif(bytes.subarray(at + 8, end - 4));
      const kept = tiff === undefined ? undefined : chunk('eXIf', tiff);
      if (kept !== undefined) parts.push(kept);
      if (kept === undefined || !sameBytes(kept, bytes.subarray(at, end))) removed.push('EXIF');
    } else if (critical || RENDERING.has(type)) {
      parts.push(bytes.subarray(at, end));
    } else {
      removed.push(LABELS[type] ?? `${type} chunk`);
    }

    at = end;
    if (type === 'IEND') {
      if (at < bytes.length) removed.push('data after the image');
      break;
    }
  }

  return stripped(bytes, parts, removed);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const typed = concat([ascii(type), body]);
  const out = new Uint8Array(body.length + 12);
  const data = view(out);
  data.setUint32(0, body.length);
  out.set(typed, 4);
  data.setUint32(8 + body.length, crc32(typed));
  return out;
}
