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

import { LANGUAGE_TAG_PATTERN } from '../site/setting-values.ts';
import { rowIndexes, trimmedField } from '../util/forms.ts';
import { findUpload, UPLOAD_ASSET_PREFIX } from '../web/assets.ts';
import type { Document } from './document.ts';
import {
  ALTERNATE_TITLE_MAX_LENGTH,
  ENCLOSURE_FRONT_MATTER_KEY,
  enclosureOf,
  isMediaType,
  isUploadUrl,
  isWebUrl,
  TRANSCRIPT_TYPES,
} from './enclosure.ts';
import type { AlternateEnclosure, Enclosure, Transcript } from './enclosure.ts';
import type { EditorField, FieldError } from './form-error.ts';
import { canonicalType, UPLOAD_MEDIA_TYPES } from './media.ts';
import type { UploadMediaType } from './media.ts';

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

/** No recording. */
export const BLANK_ENCLOSURE_FORM: EnclosureForm = {
  url: '',
  duration: '',
  transcriptUrl: '',
  transcriptType: '',
  alternates: [],
};

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

/**
 * The recording fields out of a submitted form.
 *
 * The alternate rows are numbered, so a plain form with no script can carry
 * any number of them. A row whose address was emptied is a row taken out.
 */
export function readEnclosureForm(body: Readonly<Record<string, unknown>>): EnclosureForm {
  const names = ENCLOSURE_FIELDS.alternate;
  return {
    url: trimmedField(body, ENCLOSURE_FIELDS.url),
    duration: trimmedField(body, ENCLOSURE_FIELDS.duration),
    transcriptUrl: trimmedField(body, ENCLOSURE_FIELDS.transcriptUrl),
    transcriptType: trimmedField(body, ENCLOSURE_FIELDS.transcriptType),
    alternates: rowIndexes(body, names.url)
      .map((index) => ({
        url: trimmedField(body, `${names.url}${String(index)}`),
        type: trimmedField(body, `${names.type}${String(index)}`),
        title: trimmedField(body, `${names.title}${String(index)}`),
        height: trimmedField(body, `${names.height}${String(index)}`),
        lang: trimmedField(body, `${names.lang}${String(index)}`),
      }))
      .filter((row) => row.url !== ''),
  };
}

/**
 * What a post's front matter says about its recording, as the editor shows it.
 *
 * A hand-written recording the CMS cannot use still shows its address, so
 * saving the post says what is wrong with it rather than quietly deleting it.
 */
export function enclosureForm(document: Document): EnclosureForm {
  const enclosure = enclosureOf(document.extra);
  if (enclosure === undefined) {
    const raw: unknown = document.extra[ENCLOSURE_FRONT_MATTER_KEY];
    const url =
      typeof raw === 'object' && raw !== null && 'url' in raw && typeof raw.url === 'string'
        ? raw.url
        : '';
    return { ...BLANK_ENCLOSURE_FORM, url };
  }
  return {
    url: enclosure.url,
    duration: enclosure.duration === undefined ? '' : formatDuration(enclosure.duration),
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

/** A recording the form described, or why it cannot be saved. */
export type ResolvedEnclosure = { enclosure: Enclosure | undefined } | FieldError;

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

  const main = measuredUpload(form.url, contentDir, ['audio', 'video']);
  if (main === undefined) {
    return {
      error: 'The recording has to be an audio or video file in the media library.',
      field: 'editor-enclosure-url',
    };
  }

  let duration: number | undefined;
  if (form.duration !== '') {
    duration = parseDuration(form.duration);
    if (duration === undefined) {
      return {
        error: 'A duration is seconds, or minutes and seconds like 30:34, or hours like 1:02:03.',
        field: 'editor-enclosure-duration',
      };
    }
  }

  const transcript = resolveTranscript(form, contentDir);
  if (transcript !== undefined && 'error' in transcript) return transcript;

  const alternates: AlternateEnclosure[] = [];
  for (const [index, row] of form.alternates.entries()) {
    const alternate = resolveAlternate(row, index, previous, contentDir);
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

function resolveTranscript(
  form: EnclosureForm,
  contentDir: string,
): Transcript | FieldError | undefined {
  if (form.transcriptUrl === '') return undefined;

  if (isUploadUrl(form.transcriptUrl)) {
    const asset = findUpload(form.transcriptUrl.slice(UPLOAD_ASSET_PREFIX.length), contentDir);
    const type = transcriptTypeFor(path.extname(form.transcriptUrl).toLowerCase());
    if (asset === undefined || type === undefined) {
      return {
        error:
          'A transcript in the media library has to be a .vtt, .srt or .txt file that is there.',
        field: 'editor-enclosure-transcript',
      };
    }
    return { url: form.transcriptUrl, type };
  }

  if (!isWebUrl(form.transcriptUrl)) {
    return {
      error: 'A transcript is a file in the media library or an address starting https://.',
      field: 'editor-enclosure-transcript',
    };
  }
  const type = TRANSCRIPT_TYPES.find((known) => known === form.transcriptType);
  if (type === undefined) {
    return {
      error: 'Say what kind of file a linked transcript is.',
      field: 'editor-enclosure-transcript-type',
    };
  }
  return { url: form.transcriptUrl, type };
}

function resolveAlternate(
  row: AlternateRow,
  index: number,
  previous: Enclosure | undefined,
  contentDir: string,
): AlternateEnclosure | FieldError {
  const field = (box: keyof AlternateRow): EditorField =>
    `editor-alternate-${box}-${String(index)}`;
  if (row.title.length > ALTERNATE_TITLE_MAX_LENGTH) {
    return {
      error: `An alternate version’s title is at most ${String(ALTERNATE_TITLE_MAX_LENGTH)} characters.`,
      field: field('title'),
    };
  }
  const height = row.height === '' ? undefined : Number(row.height);
  if (height !== undefined && !(Number.isSafeInteger(height) && height > 0)) {
    return {
      error: 'An alternate version’s height is a number of pixels, like 720.',
      field: field('height'),
    };
  }
  if (row.lang !== '' && !LANGUAGE_TAG_PATTERN.test(row.lang)) {
    return {
      error: 'An alternate version’s language is a language tag, such as en or pt-BR.',
      field: field('lang'),
    };
  }
  const described = {
    ...(row.title === '' ? {} : { title: row.title }),
    ...(height === undefined ? {} : { height }),
    ...(row.lang === '' ? {} : { lang: row.lang }),
  };

  if (isUploadUrl(row.url)) {
    const file = measuredUpload(row.url, contentDir, ['audio', 'video']);
    if (file === undefined) {
      return {
        error: `${row.url} is not an audio or video file in the media library.`,
        field: field('url'),
      };
    }
    return { url: row.url, type: file.type, length: file.length, ...described };
  }

  if (!isWebUrl(row.url)) {
    return {
      error: `An alternate version is a file in the media library or an address starting https://, not ${row.url}.`,
      field: field('url'),
    };
  }
  const type = row.type.toLowerCase();
  if (!isMediaType(type)) {
    return {
      error: `Say what type of file ${row.url} is, such as video/mp4 or audio/mpeg.`,
      field: field('type'),
    };
  }
  const length = previous?.alternates.find((known) => known.url === row.url)?.length;
  return { url: row.url, type, ...(length === undefined ? {} : { length }), ...described };
}

function measuredUpload(
  url: string,
  contentDir: string,
  kinds: readonly UploadMediaType['kind'][],
): { type: string; length: number } | undefined {
  if (!isUploadUrl(url)) return undefined;
  const media = UPLOAD_MEDIA_TYPES.get(path.extname(url).toLowerCase());
  if (media === undefined || !kinds.includes(media.kind)) return undefined;
  const asset = findUpload(url.slice(UPLOAD_ASSET_PREFIX.length), contentDir);
  const type = canonicalType(media);
  if (asset === undefined || type === undefined || asset.stats.size === 0) return undefined;
  return { type, length: asset.stats.size };
}

export function transcriptTypeFor(extension: string): Transcript['type'] | undefined {
  const media = UPLOAD_MEDIA_TYPES.get(extension);
  const declared = media === undefined ? undefined : canonicalType(media);
  return TRANSCRIPT_TYPES.find((known) => known === declared);
}

function parseDuration(value: string): number | undefined {
  const parts = value.split(':');
  if (parts.length > 3 || !parts.every((part) => /^\d+$/.test(part))) return undefined;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((part) => part > 59)) return undefined;
  const total = numbers.reduce((sum, part) => sum * 60 + part, 0);
  return total > 0 ? total : undefined;
}

function formatDuration(total: number): string {
  if (!Number.isInteger(total)) return String(total);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${String(minutes)}:${rest}`;
}
