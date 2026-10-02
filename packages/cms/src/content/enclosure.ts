/**
 * A post's recording: one main audio or video file, the other versions of it,
 * and its transcript (TASK-213).
 *
 * The front matter spells it the way RSS does, so a person reading the file
 * and a person reading the feed see the same names:
 *
 * ```yaml
 * enclosure:
 *   url: /uploads/2026/10/episode-12.mp3
 *   type: audio/mpeg
 *   length: 23456789
 *   duration: 1834
 *   transcript:
 *     url: /uploads/2026/10/episode-12.vtt
 *     type: text/vtt
 *   alternates:
 *     - url: https://cdn.example.com/episode-12.mp4
 *       type: video/mp4
 *       title: Video
 * ```
 *
 * It is not a key the CMS models in {@link Document}: like `license`, it stays
 * in {@link Document.extra}, so an admin save and an Eleventy build both see
 * exactly what the file says. {@link enclosureOf} is the one reading of it,
 * and the feeds, the theme and the federation read only what it returns.
 */
import { UPLOAD_ASSET_PREFIX } from '../web/assets.ts';

/** The front matter key the recording is under. */
export const ENCLOSURE_FRONT_MATTER_KEY = 'enclosure';

/** The longest title an alternate version may have, as the Podcasting 2.0 namespace says. */
export const ALTERNATE_TITLE_MAX_LENGTH = 32;

/** The transcript formats the Podcasting 2.0 namespace names, and so the ones a feed can carry. */
export const TRANSCRIPT_TYPES = [
  'text/vtt',
  'application/x-subrip',
  'text/html',
  'text/plain',
] as const;

/** One of {@link TRANSCRIPT_TYPES}. */
export type TranscriptType = (typeof TRANSCRIPT_TYPES)[number];

/** A transcript or captions file for the recording. */
export interface Transcript {
  /** An upload's site-relative URL, or an absolute `http` or `https` one. */
  url: string;
  type: TranscriptType;
}

/** Another version of the recording: a video of an audio episode, a smaller file. */
export interface AlternateEnclosure {
  /** An upload's site-relative URL, or an absolute `http` or `https` one. */
  url: string;
  /** Its media type, which a feed cannot leave out. */
  type: string;
  /** Bytes. Known for an upload; for a link, only when the author said. */
  length?: number | undefined;
  /** What a player calls it, at most {@link ALTERNATE_TITLE_MAX_LENGTH} characters. */
  title?: string | undefined;
  /** A video's height in pixels. */
  height?: number | undefined;
  /** The language it is in, as a language tag. */
  lang?: string | undefined;
}

/** A post's recording, read from its front matter. */
export interface Enclosure {
  /** The main file's site-relative URL. It is always an upload, so its length is known. */
  url: string;
  type: string;
  /** Bytes, which RSS requires. */
  length: number;
  /** Seconds, when the author said. */
  duration?: number | undefined;
  transcript?: Transcript | undefined;
  /** In the order the front matter lists them; empty when there are none. */
  alternates: AlternateEnclosure[];
}

/**
 * The recording a post's front matter describes, or `undefined` when it has
 * none worth printing.
 *
 * A main file without a URL under `/uploads/`, a media type, or a positive
 * whole number of bytes is no enclosure at all: RSS requires all three, and a
 * guessed one would send a podcast app the wrong file. Anything else that is
 * wrong is dropped on its own — an alternate version with no media type, a
 * transcript of a format nobody plays, a title too long to show — so one bad
 * line in a hand-edited file costs that line and not the episode.
 */
export function enclosureOf(extra: Readonly<Record<string, unknown>>): Enclosure | undefined {
  const raw = record(extra[ENCLOSURE_FRONT_MATTER_KEY]);
  if (raw === undefined) return undefined;

  const url = uploadUrl(raw['url']);
  const type = mediaType(raw['type']);
  const length = positiveInteger(raw['length']);
  if (url === undefined || type === undefined || length === undefined) return undefined;

  const duration = typeof raw['duration'] === 'number' ? raw['duration'] : undefined;
  return {
    url,
    type,
    length,
    ...(duration !== undefined && Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    ...optional('transcript', transcriptOf(raw['transcript'])),
    alternates: Array.isArray(raw['alternates'])
      ? raw['alternates'].flatMap((entry) => alternateOf(entry) ?? [])
      : [],
  };
}

/**
 * Whether a media type is played by a `<video>` and federated as a `Video`,
 * rather than by an `<audio>` as an `Audio`. One answer for both, so the page
 * and the fediverse never disagree about what a file is.
 */
export function playsAsVideo(type: string): boolean {
  return type.toLowerCase().startsWith('video/');
}

/** Whether a transcript is timed captions, which a player can show over the recording. */
export function isCaptions(transcript: Transcript): boolean {
  return transcript.type === 'text/vtt' || transcript.type === 'application/x-subrip';
}

/** Whether a value is an absolute `http` or `https` URL. */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Whether a value is a site-relative URL under `/uploads/` that cannot climb out of it. */
export function isUploadUrl(value: string): boolean {
  return (
    value.startsWith(UPLOAD_ASSET_PREFIX) &&
    value.length > UPLOAD_ASSET_PREFIX.length &&
    !/[?#\\]/.test(value) &&
    !value.split('/').includes('..')
  );
}

/** Whether a value is a media type, `type/subtype`, with no parameters. */
export function isMediaType(value: string): boolean {
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value);
}

function alternateOf(value: unknown): AlternateEnclosure | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const url = fileUrl(raw['url']);
  const type = mediaType(raw['type']);
  if (url === undefined || type === undefined) return undefined;

  const title = trimmed(raw['title']);
  return {
    url,
    type,
    ...optional('length', positiveInteger(raw['length'])),
    ...(title !== undefined && title.length <= ALTERNATE_TITLE_MAX_LENGTH ? { title } : {}),
    ...optional('height', positiveInteger(raw['height'])),
    ...optional('lang', trimmed(raw['lang'])),
  };
}

function transcriptOf(value: unknown): Transcript | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const url = fileUrl(raw['url']);
  const type = trimmed(raw['type'])?.toLowerCase();
  if (url === undefined || type === undefined || !isTranscriptType(type)) return undefined;
  return { url, type };
}

function isTranscriptType(value: string): value is TranscriptType {
  return (TRANSCRIPT_TYPES as readonly string[]).includes(value);
}

function uploadUrl(value: unknown): string | undefined {
  const url = trimmed(value);
  return url !== undefined && isUploadUrl(url) ? url : undefined;
}

function fileUrl(value: unknown): string | undefined {
  const url = trimmed(value);
  return url !== undefined && (isUploadUrl(url) || isWebUrl(url)) ? url : undefined;
}

function mediaType(value: unknown): string | undefined {
  const type = trimmed(value)?.toLowerCase();
  return type !== undefined && isMediaType(type) ? type : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text === '' ? undefined : text;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]: V });
}
