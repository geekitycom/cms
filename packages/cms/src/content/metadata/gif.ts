import { stripped, UnreadableMetadataError } from './shared.ts';
import type { Stripped } from './shared.ts';

/** The application extensions that change how a GIF plays or looks: looping and colour. */
const PLAYBACK = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0', 'ICCRGBG1012']);

export function stripGif(bytes: Uint8Array): Stripped {
  function fail(problem: string): never {
    throw new UnreadableMetadataError('GIF', problem);
  }
  const parts: Uint8Array[] = [];
  const removed: string[] = [];

  const subBlocksEnd = (start: number): number => {
    let at = start;
    for (;;) {
      const size = bytes[at];
      if (size === undefined) fail('a block runs past the end');
      if (size === 0) return at + 1;
      at += 1 + size;
    }
  };

  const packed = bytes[10] ?? 0;
  let at = 13 + ((packed & 0x80) !== 0 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  if (at > bytes.length) fail('the colour table runs past the end');
  parts.push(bytes.subarray(0, at));

  for (;;) {
    const introducer = bytes[at];
    if (introducer === undefined) break;

    if (introducer === 0x3b) {
      parts.push(bytes.subarray(at, at + 1));
      if (at + 1 < bytes.length) removed.push('data after the image');
      break;
    }

    if (introducer === 0x2c) {
      const flags = bytes[at + 9] ?? 0;
      const table = (flags & 0x80) !== 0 ? 3 * 2 ** ((flags & 0x07) + 1) : 0;
      const end = subBlocksEnd(at + 10 + table + 1);
      parts.push(bytes.subarray(at, end));
      at = end;
      continue;
    }

    if (introducer !== 0x21) fail(`unknown block 0x${introducer.toString(16)}`);
    const label = bytes[at + 1];
    const end = subBlocksEnd(at + 2);
    if (label === 0xfe) {
      removed.push('comment');
    } else if (label === 0xff) {
      const name = String.fromCharCode(...bytes.subarray(at + 3, at + 14));
      if (PLAYBACK.has(name)) parts.push(bytes.subarray(at, end));
      else removed.push(name === 'XMP DataXMP' ? 'XMP' : `${name.trim()} extension`);
    } else {
      parts.push(bytes.subarray(at, end));
    }
    at = end;
  }

  return stripped(bytes, parts, removed);
}
