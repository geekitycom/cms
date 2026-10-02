/**
 * What may be uploaded into `content/uploads/`, described once.
 *
 * The upload endpoint is the only door into the content directory that does
 * not write Markdown, so what it accepts is a list rather than a judgement:
 * an extension the CMS has never heard of is refused, and one it has is
 * checked against the media type the browser declared and, where the format
 * has one, against the bytes the file actually starts with.
 *
 * The table lives here rather than beside the endpoint because
 * {@link ResolvedConfig} validates a site's allowlist against it, and config
 * may not depend on the admin.
 */

/** Bytes a file of some format carries at a fixed offset. */
export interface UploadSignature {
  /** Where in the file the bytes are. */
  offset: number;
  /** The bytes themselves. */
  bytes: readonly number[];
}

/**
 * What an upload is for, which decides what the CMS offers to do with it.
 *
 * An image is embedded and gets variants, audio and video can be a post's
 * enclosure and are held to their own size limit, and a document is linked.
 */
export type UploadKind = 'image' | 'audio' | 'video' | 'document';

/** One kind of file the upload endpoint knows about. */
export interface UploadMediaType {
  /**
   * Media types a browser may declare for this extension. An empty string is
   * always accepted alongside these: a browser that does not recognise a file
   * sends no type at all, and there is then nothing to disagree with.
   */
  declared: readonly string[];
  /** What the file is for. */
  kind: UploadKind;
  /**
   * Byte patterns that identify the format, as alternatives: a file matches
   * when every part of any one of them matches. Absent for the text formats,
   * which have no header to check.
   */
  signatures?: readonly (readonly UploadSignature[])[] | undefined;
}

/** The bytes of an ASCII string, for spelling a signature readably. */
function ascii(value: string): number[] {
  return [...value].map((character) => character.charCodeAt(0));
}

/**
 * An ISO base media file — MP4, M4A, M4V — whatever its brand: a box length,
 * then `ftyp`.
 */
const ISO_BASE_MEDIA: readonly UploadSignature[] = [{ offset: 4, bytes: ascii('ftyp') }];

/** An Ogg page, whatever codec is inside it. */
const OGG: readonly UploadSignature[] = [{ offset: 0, bytes: ascii('OggS') }];

/**
 * Every extension the upload endpoint can accept, and what it takes to be one.
 *
 * SVG is deliberately absent. An SVG is a document that may carry script, and
 * an upload is served from the site's own origin, so accepting one would hand
 * anybody who can reach the editor a stored cross-site scripting hole. A site
 * that wants them anyway can put `.svg` in `uploadTypes` — and then it has
 * chosen that, which is the point.
 */
export const UPLOAD_MEDIA_TYPES: ReadonlyMap<string, UploadMediaType> = new Map<
  string,
  UploadMediaType
>([
  [
    '.png',
    {
      declared: ['image/png'],
      kind: 'image',
      signatures: [[{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }]],
    },
  ],
  [
    '.jpg',
    {
      declared: ['image/jpeg', 'image/jpg'],
      kind: 'image',
      signatures: [[{ offset: 0, bytes: [0xff, 0xd8, 0xff] }]],
    },
  ],
  [
    '.jpeg',
    {
      declared: ['image/jpeg', 'image/jpg'],
      kind: 'image',
      signatures: [[{ offset: 0, bytes: [0xff, 0xd8, 0xff] }]],
    },
  ],
  [
    '.gif',
    {
      declared: ['image/gif'],
      kind: 'image',
      signatures: [
        [{ offset: 0, bytes: ascii('GIF87a') }],
        [{ offset: 0, bytes: ascii('GIF89a') }],
      ],
    },
  ],
  [
    '.webp',
    {
      declared: ['image/webp'],
      kind: 'image',
      // A WebP is a RIFF container whose form type is WEBP, so both halves of
      // the header have to be there.
      signatures: [
        [
          { offset: 0, bytes: ascii('RIFF') },
          { offset: 8, bytes: ascii('WEBP') },
        ],
      ],
    },
  ],
  [
    '.avif',
    {
      declared: ['image/avif'],
      kind: 'image',
      // An ISO base media file: a length, then `ftyp`, then the brand.
      signatures: [
        [
          { offset: 4, bytes: ascii('ftyp') },
          { offset: 8, bytes: ascii('avif') },
        ],
        [
          { offset: 4, bytes: ascii('ftyp') },
          { offset: 8, bytes: ascii('avis') },
        ],
      ],
    },
  ],
  [
    '.pdf',
    {
      declared: ['application/pdf'],
      kind: 'document',
      signatures: [[{ offset: 0, bytes: ascii('%PDF-') }]],
    },
  ],
  // The two text formats have no header. Nothing is sniffed, and nothing needs
  // to be: they are served as text, and `application/octet-stream` is allowed
  // because that is what a browser sends for a file type it does not know.
  ['.txt', { declared: ['text/plain', 'application/octet-stream'], kind: 'document' }],
  [
    '.md',
    {
      declared: ['text/markdown', 'text/x-markdown', 'text/plain', 'application/octet-stream'],
      kind: 'document',
    },
  ],
  // Transcripts and captions for a post's enclosure. WebVTT opens with its
  // name, after a byte order mark when the editor that wrote it added one.
  // SubRip has no header, so it is taken as text like the two formats above.
  [
    '.vtt',
    {
      declared: ['text/vtt', 'text/plain', 'application/octet-stream'],
      kind: 'document',
      signatures: [
        [{ offset: 0, bytes: ascii('WEBVTT') }],
        [{ offset: 0, bytes: [0xef, 0xbb, 0xbf, ...ascii('WEBVTT')] }],
      ],
    },
  ],
  [
    '.srt',
    {
      declared: ['application/x-subrip', 'text/srt', 'text/plain', 'application/octet-stream'],
      kind: 'document',
    },
  ],
  // Audio and video, for a post's enclosure. The first declared type of each
  // is the one a feed announces, so it is the most widely understood one.
  [
    '.mp3',
    {
      declared: ['audio/mpeg', 'audio/mp3'],
      kind: 'audio',
      // An ID3 tag, or straight into an MPEG audio frame: eleven sync bits,
      // then MPEG-1 or MPEG-2 layer III, with or without a CRC.
      signatures: [
        [{ offset: 0, bytes: ascii('ID3') }],
        [{ offset: 0, bytes: [0xff, 0xfb] }],
        [{ offset: 0, bytes: [0xff, 0xfa] }],
        [{ offset: 0, bytes: [0xff, 0xf3] }],
        [{ offset: 0, bytes: [0xff, 0xf2] }],
      ],
    },
  ],
  [
    '.m4a',
    {
      declared: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'],
      kind: 'audio',
      signatures: [ISO_BASE_MEDIA],
    },
  ],
  [
    '.aac',
    {
      declared: ['audio/aac', 'audio/x-aac', 'audio/aacp'],
      kind: 'audio',
      // A raw ADTS stream: twelve sync bits, MPEG-4 or MPEG-2, no CRC.
      signatures: [[{ offset: 0, bytes: [0xff, 0xf1] }], [{ offset: 0, bytes: [0xff, 0xf9] }]],
    },
  ],
  ['.ogg', { declared: ['audio/ogg', 'application/ogg'], kind: 'audio', signatures: [OGG] }],
  ['.oga', { declared: ['audio/ogg', 'application/ogg'], kind: 'audio', signatures: [OGG] }],
  ['.opus', { declared: ['audio/ogg', 'audio/opus'], kind: 'audio', signatures: [OGG] }],
  ['.mp4', { declared: ['video/mp4'], kind: 'video', signatures: [ISO_BASE_MEDIA] }],
  ['.m4v', { declared: ['video/mp4', 'video/x-m4v'], kind: 'video', signatures: [ISO_BASE_MEDIA] }],
  [
    '.webm',
    {
      declared: ['video/webm', 'audio/webm'],
      kind: 'video',
      // The EBML header every Matroska file, WebM included, opens with.
      signatures: [[{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }]],
    },
  ],
]);

/** The extensions a site may put in its allowlist, sorted. */
export const KNOWN_UPLOAD_TYPES: readonly string[] = [...UPLOAD_MEDIA_TYPES.keys()].sort();

/**
 * An extension as the allowlist spells it: lower case, with the dot.
 *
 * `PNG`, `.Png` and `png` are all the same thing to somebody writing a config
 * file, so they are the same thing here.
 */
export function normalizeUploadType(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '') return '';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

/**
 * Whether the first bytes of a file are the ones its extension implies.
 *
 * A format with no signature — the text ones — matches anything, because there
 * is nothing to compare. Returns `false` for a file too short to hold the
 * header it claims.
 */
export function matchesSignature(media: UploadMediaType, bytes: Uint8Array): boolean {
  const alternatives = media.signatures;
  if (alternatives === undefined) return true;

  return alternatives.some((signature) =>
    signature.every((part) =>
      part.bytes.every((byte, index) => bytes[part.offset + index] === byte),
    ),
  );
}
