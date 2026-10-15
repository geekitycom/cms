import { trimmedField } from '../util/forms.ts';
import { isWebUrl } from './enclosure.ts';
import type { FieldError } from './form-error.ts';
import { isPhotoUrl } from './photo.ts';
import { photoRowFromMicropub, photoToMicropub } from './photo-form.ts';
import { isReadStatus, READ_STATUSES } from './read.ts';
import type { Read, ReadOf } from './read.ts';

export interface ReadOfForm {
  name: string;
  author: string;
  uid: string;
  url: string;
  /** The cover's address, an upload or a web address (TASK-394). */
  photo: string;
  photoAlt: string;
}

export const READ_FIELDS = {
  status: 'read-status',
  name: 'read-of-name',
  author: 'read-of-author',
  uid: 'read-of-uid',
  url: 'read-of-url',
  photo: 'read-of-photo',
  photoAlt: 'read-of-photo-alt',
} as const;

export function submittedReadOfForm(body: Readonly<Record<string, unknown>>): ReadOfForm {
  return {
    name: trimmedField(body, READ_FIELDS.name),
    author: trimmedField(body, READ_FIELDS.author),
    uid: trimmedField(body, READ_FIELDS.uid),
    url: trimmedField(body, READ_FIELDS.url),
    photo: trimmedField(body, READ_FIELDS.photo),
    photoAlt: trimmedField(body, READ_FIELDS.photoAlt),
  };
}

export const BLANK_READ_OF_FORM: ReadOfForm = {
  name: '',
  author: '',
  uid: '',
  url: '',
  photo: '',
  photoAlt: '',
};

export function readOfForm(of: ReadOf | undefined): ReadOfForm {
  return {
    name: of?.name ?? '',
    author: of?.author ?? '',
    uid: of?.uid ?? '',
    url: of?.url ?? '',
    photo: of?.photo?.url ?? '',
    photoAlt: of?.photo?.alt ?? '',
  };
}

export function resolveRead(
  status: string,
  of: ReadOfForm,
): { read: Read | undefined } | FieldError {
  const filled = Object.values(of).some((value) => value !== '');
  if (status === '' && !filled) return { read: undefined };
  if (status !== '' && !isReadStatus(status)) {
    return {
      error: `A read status is ${READ_STATUSES.join(', ')}, not ${status}.`,
      field: 'editor-read-status',
    };
  }
  if (of.name === '') {
    return { error: 'A read needs the title of what was read.', field: 'editor-read-of-name' };
  }
  if (!isReadStatus(status)) {
    return {
      error: 'A read needs a read status: want to read, currently reading or finished.',
      field: 'editor-read-status',
    };
  }
  if (of.url !== '' && !isWebUrl(of.url)) {
    return {
      error:
        'The address of what was read has to be a web address, like https://example.com/a-book/.',
      field: 'editor-read-of-url',
    };
  }
  if (of.photo !== '' && !isPhotoUrl(of.photo)) {
    return {
      error:
        'A cover is an image in the media library or an address starting https://, not ' +
        `${of.photo}.`,
      field: 'editor-read-of-photo',
    };
  }
  const word = (value: string): string | undefined => (value === '' ? undefined : value);
  return {
    read: {
      status,
      of: {
        name: of.name,
        author: word(of.author),
        uid: word(of.uid),
        url: word(of.url),
        ...(of.photo === '' ? {} : { photo: { url: of.photo, alt: word(of.photoAlt) } }),
      },
    },
  };
}

const READ_OF_TEXT_PROPERTIES = ['name', 'author', 'uid', 'url'] as const;
const READ_OF_PROPERTIES = [...READ_OF_TEXT_PROPERTIES, 'photo'] as const;

export function readOfFromMicropub(
  values: readonly unknown[],
  refuse: (message: string) => void,
  baseUrl: string,
): ReadOfForm {
  if (values.length > 1) refuse('read-of takes one value.');
  const [value] = values;
  if (value === undefined) return BLANK_READ_OF_FORM;
  const { type, properties } =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  if (
    !Array.isArray(type) ||
    !type.includes('h-cite') ||
    typeof properties !== 'object' ||
    properties === null
  ) {
    refuse('read-of is an h-cite, { "type": ["h-cite"], "properties": { "name": ["…"] } }.');
    return BLANK_READ_OF_FORM;
  }
  const given = properties as Record<string, unknown>;
  const unknown = Object.keys(given).filter(
    (name) => !(READ_OF_PROPERTIES as readonly string[]).includes(name),
  );
  if (unknown.length > 0) refuse(`read-of does not understand ${unknown.join(', ')}.`);
  const field = (name: (typeof READ_OF_TEXT_PROPERTIES)[number]): string => {
    const values = given[name] ?? [];
    if (
      !Array.isArray(values) ||
      values.length > 1 ||
      !values.every((v) => typeof v === 'string')
    ) {
      refuse(`read-of ${name} takes one text value.`);
      return '';
    }
    return (values[0] ?? '').trim();
  };
  const photos = given.photo ?? [];
  let photo = { url: '', alt: '' };
  if (!Array.isArray(photos) || photos.length > 1) refuse('read-of photo takes one value.');
  else if (photos.length === 1) {
    const row = photoRowFromMicropub(photos[0], baseUrl);
    if (row === undefined)
      refuse('read-of photo is a web address or { "value": "…", "alt": "…" }.');
    else photo = row;
  }
  return {
    name: field('name'),
    author: field('author'),
    uid: field('uid'),
    url: field('url'),
    photo: photo.url,
    photoAlt: photo.alt,
  };
}

export function readCite(
  { photo, ...of }: ReadOf,
  baseUrl: string,
): {
  type: string[];
  properties: Record<string, unknown[]>;
} {
  const fields = Object.entries(of).filter(([, value]) => value !== undefined);
  return {
    type: ['h-cite'],
    properties: {
      ...Object.fromEntries(fields.map(([name, value]) => [name, [value]])),
      ...(photo === undefined
        ? {}
        : { photo: [photoToMicropub({ url: photo.url, alt: photo.alt ?? '' }, baseUrl)] }),
    },
  };
}
