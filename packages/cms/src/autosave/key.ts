import { randomBytes } from 'node:crypto';
import path from 'node:path';

/** The editor field, and the query parameter, that carry a document's autosave key. */
export const AUTOSAVE_FIELD = 'autosave';

const MINTED = /^new-[0-9a-f]{32}$/;

const LONGEST_PATH = 1024;

/**
 * Which copy a key names: one of a document not saved yet, by the id its
 * editor was given, or one of a document that exists, by its content path.
 */
export type AutosaveKey =
  | { readonly kind: 'new'; readonly key: string }
  | { readonly kind: 'existing'; readonly key: string; readonly path: string };

/** The id a new document's editor carries until the document is saved and has a path. */
export function mintAutosaveId(): string {
  return `new-${randomBytes(16).toString('hex')}`;
}

export function isMintedAutosaveId(value: unknown): value is string {
  return typeof value === 'string' && MINTED.test(value);
}

/**
 * A submitted key, or `undefined` when it is neither a minted id nor the
 * `/`-separated path of a Markdown file inside `contentDir`.
 */
export function parseAutosaveKey(contentDir: string, value: unknown): AutosaveKey | undefined {
  if (isMintedAutosaveId(value)) return { kind: 'new', key: value };
  if (typeof value !== 'string' || value.length > LONGEST_PATH) return undefined;
  // eslint-disable-next-line no-control-regex
  if (!value.endsWith('.md') || /[\\\u0000-\u001f\u007f]/.test(value)) return undefined;
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return undefined;
  }
  const root = path.resolve(contentDir);
  if (!path.resolve(root, ...segments).startsWith(root + path.sep)) return undefined;
  return { kind: 'existing', key: value, path: value };
}
