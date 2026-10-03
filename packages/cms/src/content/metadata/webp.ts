import { ascii, concat, fourcc, sameBytes, startsWith, stripped, view } from './shared.ts';
import type { Stripped } from './shared.ts';
import { keptExif } from './tiff.ts';

const PICTURE = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

const HAS_EXIF = 0x08;
const HAS_XMP = 0x04;

export function stripWebp(bytes: Uint8Array): Stripped {
  const data = view(bytes);
  const chunks: Uint8Array[] = [];
  const removed: string[] = [];
  let keptExifChunk = false;
  let vp8x: number | undefined;

  for (let at = 12; at < bytes.length;) {
    if (at + 8 > bytes.length) {
      chunks.push(bytes.subarray(at));
      break;
    }
    const type = fourcc(bytes, at);
    const size = data.getUint32(at + 4, true);
    const end = Math.min(bytes.length, at + 8 + size + (size % 2));
    const original = bytes.subarray(at, end);

    if (type === 'EXIF') {
      let tiff = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size));
      // Some writers keep JPEG's "Exif\0\0" in front of the TIFF header.
      if (startsWith(tiff, ascii('Exif\0\0'))) tiff = tiff.subarray(6);
      const kept = keptExif(tiff);
      if (kept === undefined) {
        removed.push('EXIF');
      } else {
        const replacement = riffChunk('EXIF', kept);
        if (!sameBytes(replacement, original)) removed.push('EXIF');
        chunks.push(replacement);
        keptExifChunk = true;
      }
    } else if (PICTURE.has(type)) {
      if (type === 'VP8X') vp8x = chunks.length;
      chunks.push(original);
    } else {
      removed.push(type === 'XMP ' ? 'XMP' : `${type.trim()} chunk`);
    }
    at = end;
  }

  if (vp8x !== undefined) {
    const header = Uint8Array.from(chunks[vp8x] as Uint8Array);
    const flags = header[8] ?? 0;
    header[8] = (flags & ~(HAS_EXIF | HAS_XMP)) | (keptExifChunk ? HAS_EXIF : 0);
    chunks[vp8x] = header;
  }

  const body = concat(chunks);
  const riff = new Uint8Array(12);
  riff.set(bytes.subarray(0, 12));
  view(riff).setUint32(4, body.length + 4, true);
  return stripped(bytes, [riff, body], removed);
}

function riffChunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length + (body.length % 2));
  out.set(ascii(type));
  view(out).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}
