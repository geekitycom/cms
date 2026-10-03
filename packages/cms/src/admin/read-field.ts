import { isWebUrl } from '../content/enclosure.ts';
import { isReadStatus, READ_STATUSES } from '../content/read.ts';
import type { Read, ReadOf } from '../content/read.ts';
import type { FieldError } from './editor-layout.ts';

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

export const BLANK_READ_OF_FORM: ReadOfForm = { name: '', author: '', uid: '', url: '' };

export function readOfForm(of: ReadOf | undefined): ReadOfForm {
  return {
    name: of?.name ?? '',
    author: of?.author ?? '',
    uid: of?.uid ?? '',
    url: of?.url ?? '',
  };
}

export function submittedReadOfForm(body: Record<string, unknown>): ReadOfForm {
  const field = (name: string): string => (typeof body[name] === 'string' ? body[name] : '').trim();
  return {
    name: field(READ_FIELDS.name),
    author: field(READ_FIELDS.author),
    uid: field(READ_FIELDS.uid),
    url: field(READ_FIELDS.url),
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
