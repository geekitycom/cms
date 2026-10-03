import { crc32 } from 'node:zlib';

import sharp from 'sharp';
import type { Sharp } from 'sharp';

/**
 * Files carrying the metadata a phone or an editor leaves in them, built with
 * sharp and by hand rather than committed as binaries.
 *
 * Every secret is a distinctive string, so a test can look for it in the raw
 * bytes a site stored: no decoder in between to forgive what is still there.
 */
export const SECRETS = {
  camera: 'AcmeCamCo',
  datum: 'SECRETDATUM',
  xmpCity: 'Secretville',
  iptc: 'IPTCSECRET',
  comment: 'GIFSECRET',
  location: '+51.5007-000.1246/',
} as const;

/** Whether any of {@link SECRETS} is still somewhere in these bytes. */
export function leakedSecrets(bytes: Uint8Array): string[] {
  const text = Buffer.from(bytes).toString('latin1');
  return Object.values(SECRETS).filter((secret) => text.includes(secret));
}

export function ascii(value: string): number[] {
  return [...value].map((character) => character.charCodeAt(0));
}

const EXIF = {
  IFD0: { Make: SECRETS.camera, Model: 'Phone 9' },
  IFD3: {
    GPSLatitudeRef: 'N',
    GPSLatitude: '51/1 30/1 2/1',
    GPSLongitudeRef: 'W',
    GPSLongitude: '0/1 7/1 28/1',
    GPSMapDatum: SECRETS.datum,
  },
};

const XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  `<rdf:Description xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:City="${SECRETS.xmpCity}"/>` +
  '</rdf:RDF></x:xmpmeta>';

/** A noisy picture, so a re-encode could not come back pixel for pixel. */
function picture(): Sharp {
  return sharp({
    create: {
      width: 40,
      height: 20,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  });
}

/** A JPEG with EXIF (camera and GPS), XMP, an IPTC block and a comment. */
export async function jpegWithMetadata(orientation = 1): Promise<Uint8Array> {
  let image = picture().jpeg().withExif(EXIF).withXmp(XMP);
  if (orientation !== 1) image = image.withMetadata({ orientation });
  const encoded = new Uint8Array(await image.toBuffer());
  const iptc = [
    ...ascii('Photoshop 3.0\0'),
    ...ascii('8BIM'),
    0x04,
    0x04,
    0x00,
    0x00,
    ...u32(5 + SECRETS.iptc.length),
    0x1c,
    0x02,
    0x5a,
    ...u16(SECRETS.iptc.length),
    ...ascii(SECRETS.iptc),
  ];
  const comment = ascii(SECRETS.comment);
  return new Uint8Array([
    ...encoded.subarray(0, 2),
    0xff,
    0xed,
    ...u16(iptc.length + 2),
    ...iptc,
    0xff,
    0xfe,
    ...u16(comment.length + 2),
    ...comment,
    ...encoded.subarray(2),
  ]);
}

/** A PNG with an eXIf chunk (camera and GPS), XMP in iTXt and IPTC in tEXt. */
export async function pngWithMetadata(orientation = 1): Promise<Uint8Array> {
  let image = picture().png().withExif(EXIF);
  if (orientation !== 1) image = image.withMetadata({ orientation });
  const encoded = new Uint8Array(await image.toBuffer());
  const iend = encoded.length - 12;
  return new Uint8Array([
    ...encoded.subarray(0, iend),
    ...pngChunk('iTXt', [...ascii('XML:com.adobe.xmp\0\0\0\0\0'), ...ascii(XMP)]),
    ...pngChunk('tEXt', ascii(`Raw profile type iptc\0${SECRETS.iptc}`)),
    ...pngChunk('tIME', [0x07, 0xea, 0x0a, 0x02, 0x0c, 0x00, 0x00]),
    ...encoded.subarray(iend),
  ]);
}

/** A WebP with EXIF (camera and GPS) and XMP chunks. */
export async function webpWithMetadata(orientation = 1): Promise<Uint8Array> {
  let image = picture().webp().withExif(EXIF).withXmp(XMP);
  if (orientation !== 1) image = image.withMetadata({ orientation });
  return new Uint8Array(await image.toBuffer());
}

/** An AVIF with Exif (camera and GPS) and XMP items. */
export async function avifWithMetadata(): Promise<Uint8Array> {
  return new Uint8Array(await picture().avif().withExif(EXIF).withXmp(XMP).toBuffer());
}

/** A GIF with a comment extension and an XMP application extension. */
export async function gifWithMetadata(): Promise<Uint8Array> {
  const encoded = new Uint8Array(await picture().gif().toBuffer());
  const trailer = encoded.length - 1;
  const xmp = ascii(`<x:xmpmeta city="${SECRETS.xmpCity}"/>`);
  return new Uint8Array([
    ...encoded.subarray(0, trailer),
    0x21,
    0xfe,
    SECRETS.comment.length,
    ...ascii(SECRETS.comment),
    0x00,
    0x21,
    0xff,
    0x0b,
    ...ascii('XMP DataXMP'),
    xmp.length,
    ...xmp,
    0x00,
    ...encoded.subarray(trailer),
  ]);
}

/**
 * A minimal MP4 the way a phone writes its location: ©xyz in moov/udta,
 * the QuickTime location key in moov/meta, a track-level udta and an XMP uuid
 * box at the top level. The media data is a stand-in; nothing here decodes it.
 */
export function mp4WithLocation(brand = 'isom'): Uint8Array {
  const location = ascii(SECRETS.location);
  const xyz = box('©xyz', [...u16(location.length), 0x15, 0xc7, ...location]);
  const keys = box('keys', [
    ...u32(0),
    ...u32(1),
    ...box('mdta', ascii('com.apple.quicktime.location.ISO6709')),
  ]);
  const ilst = box('ilst', box(u32Name(1), box('data', [...u32(1), ...u32(0), ...location])));
  const meta = box('meta', [
    ...box('hdlr', [...new Array<number>(8).fill(0), ...ascii('mdta')]),
    ...keys,
    ...ilst,
  ]);
  const trak = box('trak', [
    ...box('tkhd', new Array<number>(84).fill(0)),
    ...box('udta', box('©mak', ascii(SECRETS.camera))),
  ]);
  const moov = box('moov', [
    ...box('mvhd', new Array<number>(100).fill(0)),
    ...trak,
    ...box('udta', xyz),
    ...meta,
  ]);
  const xmpUuid = box('uuid', [...hex('be7acfcb97a942e89c71999491e3afac'), ...ascii(XMP)]);
  return new Uint8Array([
    ...box('ftyp', [...ascii(brand), ...u32(0), ...ascii(brand)]),
    ...moov,
    ...xmpUuid,
    ...box('mdat', new Array<number>(64).fill(0x42)),
  ]);
}

/** The four-character type and size of every box at the top of an ISO file. */
export function topLevelBoxes(bytes: Uint8Array): { type: string; size: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: { type: string; size: number }[] = [];
  for (let at = 0; at + 8 <= bytes.length;) {
    const size = view.getUint32(at);
    found.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), size });
    at += size;
  }
  return found;
}

function box(type: string, body: readonly number[]): number[] {
  return [...u32(body.length + 8), ...[...type].map((c) => c.charCodeAt(0) & 0xff), ...body];
}

function u32Name(value: number): string {
  return String.fromCharCode(...u32(value));
}

function pngChunk(type: string, data: readonly number[]): number[] {
  const typed = new Uint8Array([...ascii(type), ...data]);
  return [...u32(data.length), ...typed, ...u32(crc32(typed))];
}

function hex(value: string): number[] {
  return [...Buffer.from(value, 'hex')];
}

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
