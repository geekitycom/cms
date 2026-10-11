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
