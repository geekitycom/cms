import { trimmedField } from '../util/forms.ts';
import { isWebUrl } from './enclosure.ts';
import type { FieldError } from './form-error.ts';
import { isReadStatus, READ_STATUSES } from './read.ts';
import type { Read, ReadOf } from './read.ts';

export interface ReadOfForm {
  name: string;
  author: string;
  uid: string;
  url: string;
}

export const READ_FIELDS = {
  status: 'read-status',
  name: 'read-of-name',
  author: 'read-of-author',
  uid: 'read-of-uid',
  url: 'read-of-url',
} as const;

export function submittedReadOfForm(body: Readonly<Record<string, unknown>>): ReadOfForm {
  return {
    name: trimmedField(body, READ_FIELDS.name),
    author: trimmedField(body, READ_FIELDS.author),
    uid: trimmedField(body, READ_FIELDS.uid),
    url: trimmedField(body, READ_FIELDS.url),
  };
}

export const BLANK_READ_OF_FORM: ReadOfForm = { name: '', author: '', uid: '', url: '' };

export function readOfForm(of: ReadOf | undefined): ReadOfForm {
  return {
    name: of?.name ?? '',
    author: of?.author ?? '',
    uid: of?.uid ?? '',
    url: of?.url ?? '',
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
  const word = (value: string): string | undefined => (value === '' ? undefined : value);
  return {
    read: {
      status,
      of: { name: of.name, author: word(of.author), uid: word(of.uid), url: word(of.url) },
    },
  };
}

const READ_OF_PROPERTIES = ['name', 'author', 'uid', 'url'] as const;

export function readOfFromMicropub(
  values: readonly unknown[],
  refuse: (message: string) => void,
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
  const field = (name: (typeof READ_OF_PROPERTIES)[number]): string => {
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
  return { name: field('name'), author: field('author'), uid: field('uid'), url: field('url') };
}

export function readCite(of: ReadOf): object {
  const fields = Object.entries(of).filter(([, value]) => value !== undefined);
  return {
    type: ['h-cite'],
    properties: Object.fromEntries(fields.map(([name, value]) => [name, [value]])),
  };
}
