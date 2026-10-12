import type { PictureSource } from '../cited-picture.ts';
import { webUrl } from '../fetch-public.ts';
import type { HostLookup } from '../public-address.ts';

/**
 * What every source of a reply context shares: the partial context each one
 * answers with, the limits a fetching source works within, and the merge that
 * joins them.
 */

/** The bounds one cited page's every request shares. */
export interface Limits {
  readonly lookup: HostLookup;
  readonly deadline: AbortSignal;
  readonly maxBytes: number;
}

/**
 * A note's name is its text, so a source that found a note says so rather than
 * leaving the name empty for a later source's title to fill.
 */
export const NAMELESS_NOTE: unique symbol = Symbol('nameless note');

/** What one source says about a cited page. Every field is optional. */
export interface Source {
  readonly name?: string | typeof NAMELESS_NOTE;
  readonly text?: string;
  readonly author?: { readonly name: string; readonly url?: string; readonly handle?: string };
  /** The author's avatar, where it is on the web. */
  readonly photo?: string;
  readonly published?: string;
  readonly site?: string;
  readonly start?: string;
  readonly location?: string;
  readonly picture?: PictureSource;
}

/**
 * Join sources in order of trust: each fills only what the ones before it left
 * empty, and an author is filled in only from a source naming the same person.
 */
export function merge(sources: readonly (Source | undefined)[]): Source {
  let merged: Source = {};
  for (const source of sources) {
    if (source === undefined) continue;
    const { author, photo, ...fields } = source;
    merged = { ...fields, ...merged, ...mergeAuthor(merged, author, photo) };
  }
  return merged;
}

function mergeAuthor(
  merged: Source,
  author: Source['author'],
  photo: string | undefined,
): Pick<Source, 'author' | 'photo'> {
  const held = merged.author;
  const samePerson =
    author !== undefined &&
    (held === undefined || held.name.toLowerCase() === author.name.toLowerCase());
  if (!samePerson) return {};
  return {
    author: { ...author, ...held },
    ...(merged.photo === undefined && photo !== undefined ? { photo } : {}),
  };
}

export function plainText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? undefined : text;
}

export function withoutDirectionControls(text: string | undefined): string {
  return (text ?? '')
    .replace(/\p{Bidi_Control}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** An href as an absolute http(s) URL against a base, or `undefined`. */
export function resolved(href: string | undefined, base: string): string | undefined {
  if (href === undefined) return undefined;
  try {
    return webUrl(new URL(href, base).href)?.href;
  } catch {
    return undefined;
  }
}
