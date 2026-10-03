import { isWebUrl } from '../content/enclosure.ts';
import { isReadStatus, READ_STATUSES } from '../content/read.ts';
import type { Read, ReadOf } from '../content/read.ts';

/** The editor's fields for the work a read post read (TASK-229). */
export interface ReadOfForm {
  name: string;
  author: string;
  uid: string;
  url: string;
}

/** The name each field submits under. */
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

/**
 * The read a form's fields make, `undefined` when they are all empty, or why
 * they make none: a read-status and the title of what was read only mean
 * something together.
 */
export function resolveRead(
  status: string,
  of: ReadOfForm,
): { read: Read | undefined } | { error: string } {
  const filled = Object.values(of).some((value) => value !== '');
  if (status === '' && !filled) return { read: undefined };
  if (status !== '' && !isReadStatus(status)) {
    return { error: `A read status is ${READ_STATUSES.join(', ')}, not ${status}.` };
  }
  if (of.name === '') return { error: 'A read needs the title of what was read.' };
  if (!isReadStatus(status)) {
    return { error: 'A read needs a read status: want to read, currently reading or finished.' };
  }
  if (of.url !== '' && !isWebUrl(of.url)) {
    return {
      error:
        'The address of what was read has to be a web address, like https://example.com/a-book/.',
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
