import {
  ascii,
  concat,
  sameBytes,
  startsWith,
  stripped,
  UnreadableMetadataError,
  view,
} from './shared.ts';
import type { Stripped } from './shared.ts';
import { keptExif } from './tiff.ts';

const EXIF = ascii('Exif\0\0');
const ICC = ascii('ICC_PROFILE\0');
const ADOBE = ascii('Adobe');

const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP13 = 0xed;
const APP14 = 0xee;
const APP15 = 0xef;
const COM = 0xfe;
const SOS = 0xda;
const EOI = 0xd9;

/**
 * What one application segment is, by its marker and the name it opens with:
 * a label to report when it goes, or `undefined` for one the picture needs.
 *
 * Kept: JFIF, the ICC colour profile and Adobe's colour-transform flag, each of
 * which changes how the pixels decode. Everything else an APPn can hold is
 * about the photo rather than the picture — EXIF, XMP, IPTC, the multi-picture
 * index of a phone's depth map — and goes.
 */
function segmentLabel(marker: number, body: Uint8Array): string | undefined {
  if (marker === APP0) return undefined;
  if (marker === APP2 && startsWith(body, ICC)) return undefined;
  if (marker === APP14 && startsWith(body, ADOBE)) return undefined;
  if (marker === APP1) return startsWith(body, EXIF) ? 'EXIF' : 'XMP';
  if (marker === APP13) return 'IPTC';
  if (marker === COM) return 'comment';
  return `APP${String(marker - APP0)}`;
}

/**
 * A JPEG with every metadata segment cut out and the entropy-coded data left
 * byte for byte, so nothing is re-encoded. A turned photo keeps an EXIF
 * segment holding its orientation and nothing else. Whatever follows the end
 * of the image — a phone's appended depth map or preview — goes too.
 */
export function stripJpeg(bytes: Uint8Array): Stripped {
  const fail = (problem: string): never => {
    throw new UnreadableMetadataError('JPEG', problem);
  };
  const data = view(bytes);
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  const removed: string[] = [];
  let at = 2;

  while (at < bytes.length) {
    if (bytes[at] !== 0xff) fail(`expected a marker at byte ${String(at)}`);
    // Any number of 0xFF may pad the space before a marker.
    let markerAt = at;
    while (bytes[markerAt + 1] === 0xff) markerAt += 1;
    const marker = bytes[markerAt + 1];
    if (marker === undefined) break;

    if (marker === EOI) {
      parts.push(bytes.subarray(markerAt, markerAt + 2));
      if (markerAt + 2 < bytes.length) removed.push('data after the image');
      return stripped(bytes, parts, removed);
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(bytes.subarray(at, markerAt + 2));
      at = markerAt + 2;
      continue;
    }
    if (markerAt + 4 > bytes.length) fail('a segment is cut off');
    const end = markerAt + 2 + data.getUint16(markerAt + 2);
    if (end > bytes.length || end < markerAt + 4) fail('a segment runs past the end');

    if ((marker >= APP0 && marker <= APP15) || marker === COM) {
      const body = bytes.subarray(markerAt + 4, end);
      const label = segmentLabel(marker, body);
      if (label === undefined) {
        parts.push(bytes.subarray(at, end));
      } else if (label === 'EXIF') {
        const tiff = keptExif(body.subarray(EXIF.length));
        const kept = tiff === undefined ? undefined : app1(tiff);
        if (kept !== undefined) parts.push(kept);
        if (kept === undefined || !sameBytes(kept, bytes.subarray(at, end))) removed.push('EXIF');
      } else {
        removed.push(label);
      }
      at = end;
      continue;
    }

    parts.push(bytes.subarray(at, end));
    at = end;
    if (marker === SOS) {
      // Entropy-coded data runs to the next marker: an 0xFF that is neither a
      // stuffed zero nor a restart marker.
      let scan = at;
      while (scan + 1 < bytes.length) {
        const next = bytes[scan + 1] as number;
        if (bytes[scan] === 0xff && next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) break;
        scan += 1;
      }
      if (scan + 1 >= bytes.length) scan = bytes.length;
      parts.push(bytes.subarray(at, scan));
      at = scan;
    }
  }

  return stripped(bytes, parts, removed);
}

function app1(tiff: Uint8Array): Uint8Array {
  const length = 2 + EXIF.length + tiff.length;
  return concat([Uint8Array.from([0xff, APP1, length >> 8, length & 0xff]), EXIF, tiff]);
}
