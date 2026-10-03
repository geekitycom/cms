import { ascii, view } from './shared.ts';

const ORIENTATION_TAG = 0x0112;

/**
 * The orientation an EXIF block's first IFD gives, or 1 — upright — when it
 * gives none or cannot be read. `tiff` starts at the byte-order mark.
 */
function exifOrientation(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
  const data = view(tiff);
  const ifd = data.getUint32(4, little);
  if (ifd + 2 > tiff.length) return 1;
  const entries = data.getUint16(ifd, little);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > tiff.length) return 1;
    if (
      data.getUint16(entry, little) === ORIENTATION_TAG &&
      data.getUint16(entry + 2, little) === 3
    ) {
      const value = data.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/**
 * An EXIF block holding the orientation and nothing else: a big-endian TIFF
 * header, one IFD with one SHORT entry, no next IFD.
 */
function orientationOnlyTiff(orientation: number): Uint8Array {
  const tiff = new Uint8Array(26);
  const data = view(tiff);
  tiff.set(ascii('MM'));
  data.setUint16(2, 42);
  data.setUint32(4, 8);
  data.setUint16(8, 1);
  data.setUint16(10, ORIENTATION_TAG);
  data.setUint16(12, 3);
  data.setUint32(14, 1);
  data.setUint16(18, orientation);
  return tiff;
}

/**
 * What a format should keep of an EXIF block: the orientation alone when the
 * picture is turned, since dropping it would show a phone photo sideways, and
 * nothing when it is upright.
 */
export function keptExif(tiff: Uint8Array): Uint8Array | undefined {
  const orientation = exifOrientation(tiff);
  return orientation === 1 ? undefined : orientationOnlyTiff(orientation);
}
