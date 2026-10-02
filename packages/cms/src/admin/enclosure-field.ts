/**
 * The post editor's recording fields (TASK-213): the main file, its duration,
 * its transcript and its other versions, as a form has them and as the front
 * matter gets them.
 *
 * The form carries strings and the author chooses files; the server fills in
 * what only the file can say. A main file's media type and length come from
 * the upload table and from the file on disk, never from the form, because a
 * feed that announces the wrong length makes a podcast app give up on the
 * download halfway. Everything is checked before anything is written, so a
 * refused recording is a refused save.
 */
import path from 'node:path';

import {
  ALTERNATE_TITLE_MAX_LENGTH,
  enclosureOf,
  isMediaType,
  isUploadUrl,
  isWebUrl,
  TRANSCRIPT_TYPES,
} from '../content/enclosure.ts';
import type { Document } from '../content/document.ts';
import type { AlternateEnclosure, Enclosure, Transcript } from '../content/enclosure.ts';
import { UPLOAD_MEDIA_TYPES } from '../content/media.ts';
import type { UploadMediaType } from '../content/media.ts';
import { findUpload, UPLOAD_ASSET_PREFIX } from '../web/assets.ts';
import { listUploads } from './media.ts';
import { LANGUAGE_TAG_PATTERN } from './settings.ts';

/** One alternate version's row, as the form has it. */
export interface AlternateRow {
  url: string;
  /** Only read for a link; an upload's type comes from the file. */
  type: string;
  title: string;
  height: string;
  lang: string;
}

/** The recording fields, as strings, which is what a form has. */
export interface EnclosureForm {
  /** The main file's upload URL; empty for none. */
  url: string;
  /** Seconds, or `M:SS` or `H:MM:SS`; empty when nobody said. */
  duration: string;
  transcriptUrl: string;
  /** Only read for a link; an upload's type comes from its extension. */
  transcriptType: string;
  /** Without the blank row the editor adds for a new version. */
  alternates: AlternateRow[];
}

/** The form field names, in one place for the template and the reader. */
export const ENCLOSURE_FIELDS = {
  url: 'enclosure-url',
  duration: 'enclosure-duration',
  transcriptUrl: 'enclosure-transcript-url',
  transcriptType: 'enclosure-transcript-type',
  alternate: {
    url: 'alternate-url-',
    type: 'alternate-type-',
    title: 'alternate-title-',
    height: 'alternate-height-',
    lang: 'alternate-lang-',
  },
} as const;

/** No recording. */
export const BLANK_ENCLOSURE_FORM: EnclosureForm = {
  url: '',
  duration: '',
  transcriptUrl: '',
  transcriptType: '',
  alternates: [],
};

/** What a post's front matter says about its recording, as the editor shows it. */
export function enclosureForm(document: Document): EnclosureForm {
  const enclosure = enclosureOf(document.extra);
  if (enclosure === undefined) return BLANK_ENCLOSURE_FORM;
  return {
    url: enclosure.url,
    duration: enclosure.duration === undefined ? '' : clockTime(enclosure.duration),
    transcriptUrl: enclosure.transcript?.url ?? '',
    transcriptType: enclosure.transcript?.type ?? '',
    alternates: enclosure.alternates.map((alternate) => ({
      url: alternate.url,
      type: alternate.type,
      title: alternate.title ?? '',
      height: alternate.height === undefined ? '' : String(alternate.height),
      lang: alternate.lang ?? '',
    })),
  };
}

/**
 * The recording fields out of a submitted form.
 *
 * The alternate rows are numbered, so a plain form with no script can carry
 * any number of them. A row whose address was emptied is a row taken out.
 */
export function readEnclosureForm(body: Record<string, unknown>): EnclosureForm {
  const field = (name: string): string => (typeof body[name] === 'string' ? body[name] : '').trim();
  const rows = Object.keys(body)
    .map((name) => /^alternate-url-(\d+)$/.exec(name)?.[1])
    .filter((index) => index !== undefined)
    .map(Number)
    .sort((left, right) => left - right);

  const names = ENCLOSURE_FIELDS.alternate;
  return {
    url: field(ENCLOSURE_FIELDS.url),
    duration: field(ENCLOSURE_FIELDS.duration),
    transcriptUrl: field(ENCLOSURE_FIELDS.transcriptUrl),
    transcriptType: field(ENCLOSURE_FIELDS.transcriptType),
    alternates: rows
      .map((index) => ({
        url: field(`${names.url}${String(index)}`),
        type: field(`${names.type}${String(index)}`),
        title: field(`${names.title}${String(index)}`),
        height: field(`${names.height}${String(index)}`),
        lang: field(`${names.lang}${String(index)}`),
      }))
      .filter((row) => row.url !== ''),
  };
}

/** A recording the form described, or why it cannot be saved. */
export type ResolvedEnclosure = { enclosure: Enclosure | undefined } | { error: string };

/**
 * The recording to write, from what the author chose and what is on disk.
 *
 * An empty main file is no recording, and takes the alternate versions and
 * the transcript with it: they are versions of a file the post no longer has.
 * A link alternate keeps a length the front matter gave it for the same
 * address, since nothing on this site can measure one.
 */
export function resolveEnclosure(
  form: EnclosureForm,
  previous: Enclosure | undefined,
  contentDir: string,
): ResolvedEnclosure {
  if (form.url === '') return { enclosure: undefined };

  const main = uploaded(form.url, contentDir, ['audio', 'video']);
  if (main === undefined) {
    return { error: 'The recording has to be an audio or video file in the media library.' };
  }

  let duration: number | undefined;
  if (form.duration !== '') {
    duration = seconds(form.duration);
    if (duration === undefined) {
      return {
        error: 'A duration is seconds, or minutes and seconds like 30:34, or hours like 1:02:03.',
      };
    }
  }

  const transcript = resolveTranscript(form, contentDir);
  if (transcript !== undefined && 'error' in transcript) return transcript;

  const alternates: AlternateEnclosure[] = [];
  for (const row of form.alternates) {
    const alternate = resolveAlternate(row, previous, contentDir);
    if ('error' in alternate) return alternate;
    alternates.push(alternate);
  }

  return {
    enclosure: {
      url: form.url,
      type: main.type,
      length: main.length,
      ...(duration === undefined ? {} : { duration }),
      ...(transcript === undefined ? {} : { transcript }),
      alternates,
    },
  };
}

/** The recording as the front matter spells it: no empty list, nothing unset. */
export function enclosureFrontMatter(enclosure: Enclosure): Record<string, unknown> {
  const { alternates, ...rest } = enclosure;
  return alternates.length === 0 ? rest : { ...rest, alternates };
}

/** The media library's choices for a post's recording, and the address it has now. */
export interface EnclosureChoices {
  /** Audio and video uploads, newest first. */
  media: { url: string; label: string }[];
  /** Upload addresses a transcript can be. */
  transcripts: string[];
}

/**
 * What the editor offers to choose from.
 *
 * A post whose file has since gone from the library keeps it as a choice of
 * its own, so opening the editor never quietly drops a recording; saving it
 * says what is wrong.
 */
export async function enclosureChoices(
  contentDir: string,
  current: string,
): Promise<EnclosureChoices> {
  const files = await listUploads(contentDir);
  const media = files
    .filter((file) => file.kind === 'audio' || file.kind === 'video')
    .map((file) => ({ url: file.url, label: file.path }));
  if (current !== '' && !media.some((file) => file.url === current)) {
    media.unshift({ url: current, label: `${current} (not in the media library)` });
  }
  return {
    media,
    transcripts: files
      .filter((file) => transcriptTypeFor(file.extension) !== undefined)
      .map((file) => file.url),
  };
}

function resolveTranscript(
  form: EnclosureForm,
  contentDir: string,
): Transcript | { error: string } | undefined {
  if (form.transcriptUrl === '') return undefined;

  if (isUploadUrl(form.transcriptUrl)) {
    const asset = findUpload(form.transcriptUrl.slice(UPLOAD_ASSET_PREFIX.length), contentDir);
    const type = transcriptTypeFor(path.extname(form.transcriptUrl).toLowerCase());
    if (asset === undefined || type === undefined) {
      return {
        error:
          'A transcript in the media library has to be a .vtt, .srt or .txt file that is there.',
      };
    }
    return { url: form.transcriptUrl, type };
  }

  if (!isWebUrl(form.transcriptUrl)) {
    return {
      error: 'A transcript is a file in the media library or an address starting https://.',
    };
  }
  const type = TRANSCRIPT_TYPES.find((known) => known === form.transcriptType);
  if (type === undefined) {
    return { error: 'Say what kind of file a linked transcript is.' };
  }
  return { url: form.transcriptUrl, type };
}

function resolveAlternate(
  row: AlternateRow,
  previous: Enclosure | undefined,
  contentDir: string,
): AlternateEnclosure | { error: string } {
  if (row.title.length > ALTERNATE_TITLE_MAX_LENGTH) {
    return {
      error: `An alternate version’s title is at most ${String(ALTERNATE_TITLE_MAX_LENGTH)} characters.`,
    };
  }
  const height = row.height === '' ? undefined : Number(row.height);
  if (height !== undefined && !(Number.isSafeInteger(height) && height > 0)) {
    return { error: 'An alternate version’s height is a number of pixels, like 720.' };
  }
  if (row.lang !== '' && !LANGUAGE_TAG_PATTERN.test(row.lang)) {
    return { error: 'An alternate version’s language is a language tag, such as en or pt-BR.' };
  }
  const described = {
    ...(row.title === '' ? {} : { title: row.title }),
    ...(height === undefined ? {} : { height }),
    ...(row.lang === '' ? {} : { lang: row.lang }),
  };

  if (isUploadUrl(row.url)) {
    const file = uploaded(row.url, contentDir, ['audio', 'video']);
    if (file === undefined) {
      return {
        error: `${row.url} is not an audio or video file in the media library.`,
      };
    }
    return { url: row.url, type: file.type, length: file.length, ...described };
  }

  if (!isWebUrl(row.url)) {
    return {
      error: `An alternate version is a file in the media library or an address starting https://, not ${row.url}.`,
    };
  }
  const type = row.type.toLowerCase();
  if (!isMediaType(type)) {
    return {
      error: `Say what type of file ${row.url} is, such as video/mp4 or audio/mpeg.`,
    };
  }
  const length = previous?.alternates.find((known) => known.url === row.url)?.length;
  return { url: row.url, type, ...(length === undefined ? {} : { length }), ...described };
}

/** An upload of one of these kinds, with what the table and the disk say it is. */
function uploaded(
  url: string,
  contentDir: string,
  kinds: readonly UploadMediaType['kind'][],
): { type: string; length: number } | undefined {
  if (!isUploadUrl(url)) return undefined;
  const media = UPLOAD_MEDIA_TYPES.get(path.extname(url).toLowerCase());
  if (media === undefined || !kinds.includes(media.kind)) return undefined;
  const asset = findUpload(url.slice(UPLOAD_ASSET_PREFIX.length), contentDir);
  const type = media.declared[0];
  if (asset === undefined || type === undefined || asset.stats.size === 0) return undefined;
  return { type, length: asset.stats.size };
}

/** The transcript type an upload's extension implies, for the ones a feed can carry. */
function transcriptTypeFor(extension: string): Transcript['type'] | undefined {
  const declared = UPLOAD_MEDIA_TYPES.get(extension)?.declared[0];
  return TRANSCRIPT_TYPES.find((known) => known === declared);
}

/** `1834`, `30:34` or `1:02:03` as seconds; `undefined` for anything else. */
function seconds(value: string): number | undefined {
  const parts = value.split(':');
  if (parts.length > 3 || !parts.every((part) => /^\d+$/.test(part))) return undefined;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((part) => part > 59)) return undefined;
  const total = numbers.reduce((sum, part) => sum * 60 + part, 0);
  return total > 0 ? total : undefined;
}

/** Seconds as the editor shows them: `30:34`, or `1:02:03` past the hour. */
function clockTime(total: number): string {
  if (!Number.isInteger(total)) return String(total);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${String(minutes)}:${rest}`;
}
