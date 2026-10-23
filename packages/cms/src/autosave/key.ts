import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const AUTOSAVE_FIELD = 'autosave';

const MINTED = /^new-[0-9a-f]{32}$/;

const LONGEST_PATH = 1024;

export type AutosaveKey =
  | { readonly kind: 'new'; readonly key: string }
  | { readonly kind: 'existing'; readonly key: string; readonly path: string };

export function mintAutosaveId(): string {
  return `new-${randomBytes(16).toString('hex')}`;
}

export function isMintedAutosaveId(value: unknown): value is string {
  return typeof value === 'string' && MINTED.test(value);
}

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
