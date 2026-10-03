import type { Document } from './document.ts';

export const VISIBILITY_FRONT_MATTER_KEY = 'visibility';

export type Visibility = 'public' | 'unlisted';

export const VISIBILITIES: readonly Visibility[] = ['public', 'unlisted'];

export interface UnrecognizedVisibility {
  readonly unrecognized: string;
}

export type StoredVisibility = Visibility | UnrecognizedVisibility;

export function isVisibility(value: unknown): value is Visibility {
  return VISIBILITIES.includes(value as Visibility);
}

export function visibilityOf(document: Pick<Document, 'extra'>): StoredVisibility {
  const value = document.extra[VISIBILITY_FRONT_MATTER_KEY];
  if (value === undefined || value === null) return 'public';
  if (isVisibility(value)) return value;
  return { unrecognized: typeof value === 'string' ? value : JSON.stringify(value) };
}
