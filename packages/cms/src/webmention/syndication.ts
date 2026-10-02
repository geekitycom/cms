import path from 'node:path';

import type { Document } from '../content/document.ts';
import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { canonicalLocale, DEFAULT_LOCALE, documentLanguage } from '../web/locale.ts';

/**
 * Syndication targets (TASK-155): services such as IndieNews and Bridgy
 * Publish that take a copy of a post when it links to them and sends them a
 * webmention, and answer with the URL of the copy they made.
 *
 * Nothing here names a service. A site declares its targets in
 * {@link SYNDICATION_TARGETS_FILE}; a post selects some with its
 * `syndicate-to` list or by carrying a target's tag; the theme links to each
 * one inside the post's h-entry; the sender notifies them as it notifies any
 * linked page; and the URL each one answers with is kept in
 * {@link SYNDICATION_FILE} (decision-26) and printed as `u-syndication`.
 */

/** Where a site declares its targets, relative to the content directory. */
export const SYNDICATION_TARGETS_FILE = '_data/syndicationTargets.json';

/**
 * Where the copies targets answered with are kept, relative to the content
 * directory: one object keyed by a post's permalink, each mapping a target's
 * URL to the copy it made (decision-26). Eleventy reads it as `syndication`.
 */
export const SYNDICATION_FILE = '_data/syndication.json';

/** The front matter key a post lists the ids of its targets under. */
export const SYNDICATE_TO_FRONT_MATTER_KEY = 'syndicate-to';

/** The front matter key, and mf2 property, for the URLs of a post's copies. */
export const SYNDICATION_FRONT_MATTER_KEY = 'syndication';

/** What an id may be made of, so it can name a form field and a Micropub uid alike. */
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** What a target's `url` may hold to follow the post's language (TASK-156). */
export const LANGUAGE_PLACEHOLDER = '{lang}';

/** One place a post can be syndicated to. */
export interface SyndicationTarget {
  /** What `syndicate-to` names it by, and its Micropub uid. */
  readonly id: string;
  /** What the editor's checkbox and the post's link say. */
  readonly name: string;
  /**
   * The page the post links to and the webmention is sent to. As declared it
   * may hold {@link LANGUAGE_PLACEHOLDER}; a target {@link selectedTargets}
   * answers with has it filled for the post.
   */
  readonly url: string;
  /** A tag that selects this target without the post listing it. */
  readonly tag?: string | undefined;
  /**
   * The languages, as canonical BCP 47 tags, the target takes posts in. A post
   * in any other language does not select it. Absent means every language.
   */
  readonly languages?: readonly string[] | undefined;
}

/** The declared targets, and a sentence for each entry that was not one. */
export interface ParsedSyndicationTargets {
  readonly targets: readonly SyndicationTarget[];
  readonly problems: readonly string[];
}

/** Read the targets file's text. An entry that is not a target is reported and left out. */
export function parseSyndicationTargets(text: string): ParsedSyndicationTargets {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { targets: [], problems: [`${SYNDICATION_TARGETS_FILE} is not valid JSON.`] };
  }
  if (!Array.isArray(parsed)) {
    return { targets: [], problems: [`${SYNDICATION_TARGETS_FILE} is not a list of targets.`] };
  }

  const targets: SyndicationTarget[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  parsed.forEach((entry: unknown, index) => {
    const where = `${SYNDICATION_TARGETS_FILE} entry ${String(index + 1)}`;
    const target = targetOf(entry);
    if (typeof target === 'string') {
      problems.push(`${where} ${target}, so it was ignored.`);
    } else if (seen.has(target.id)) {
      problems.push(`${where} repeats the id "${target.id}", so it was ignored.`);
    } else {
      seen.add(target.id);
      targets.push(target);
    }
  });

  return { targets, problems };
}

/** One entry as a target, or the reason it is not one. */
function targetOf(entry: unknown): SyndicationTarget | string {
  if (!isRecord(entry)) return 'is not an object';
  const { id, name, url, tag, languages } = entry;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    return 'has no id made of letters, digits, dots, dashes and underscores';
  }
  if (typeof name !== 'string' || name.trim() === '') return `("${id}") has no name`;
  const href = urlTemplate(url);
  if (href === undefined) return `("${id}") has no http or https url`;
  if (tag !== undefined && (typeof tag !== 'string' || tag.trim() === '')) {
    return `("${id}") has a tag that is not a word`;
  }
  const tags = languages === undefined ? undefined : languageList(languages);
  if (tags === null) return `("${id}") has a languages list that is not a list of language tags`;
  return {
    id,
    name: name.trim(),
    url: href,
    ...(tag === undefined ? {} : { tag: tag.trim() }),
    ...(tags === undefined ? {} : { languages: tags }),
  };
}

/**
 * A declared `url` as kept: an http or https URL, which may hold
 * {@link LANGUAGE_PLACEHOLDER}. One with the placeholder is checked with a
 * language filled in and kept as written, since a URL parser would escape the
 * braces.
 */
function urlTemplate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.includes(LANGUAGE_PLACEHOLDER)) return webUrl(value);
  const template = value.trim();
  return webUrl(fillLanguage(template, DEFAULT_LOCALE)) === undefined ? undefined : template;
}

/** A non-empty list of language tags, canonical, or `null` when it is not one. */
function languageList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const tags: string[] = [];
  for (const item of value) {
    const tag = typeof item === 'string' ? canonicalLocale(item) : undefined;
    if (tag === undefined) return null;
    tags.push(tag);
  }
  return tags;
}

/**
 * The targets a site declares, read from its content directory.
 *
 * Read on every call and parsed again only when the bytes change, the way the
 * reply contexts are, so a target added by hand is offered on the next page.
 */
export interface SyndicationTargetsReader {
  (): readonly SyndicationTarget[];
}

/** A reader over one content directory's targets file. A missing file declares none. */
export function syndicationTargetsReader(contentDir: string): SyndicationTargetsReader {
  const file = path.join(contentDir, ...SYNDICATION_TARGETS_FILE.split('/'));
  let cachedText: string | undefined;
  let cached: readonly SyndicationTarget[] = [];

  return () => {
    const text = readFileIfPresentSync(file);
    if (text === undefined) {
      cachedText = undefined;
      cached = [];
    } else if (text !== cachedText) {
      cachedText = text;
      cached = parseSyndicationTargets(text).targets;
    }
    return cached;
  };
}

/** What is wrong with a content directory's targets file, for the boot log. */
export function syndicationTargetProblems(contentDir: string): readonly string[] {
  const text = readFileIfPresentSync(path.join(contentDir, ...SYNDICATION_TARGETS_FILE.split('/')));
  return text === undefined ? [] : parseSyndicationTargets(text).problems;
}

/**
 * The declared targets a post selects, in the order the site declares them,
 * each with its `url` filled for the post: those its `syndicate-to` names, and
 * those whose tag it carries. An id nobody declared selects nothing.
 *
 * The post's language is its own `lang`, else `siteLanguage` (TASK-156). A
 * target that lists `languages` is selected only for a post in one of them or
 * in a regional form of one, so `de-AT` goes to a target that lists `de`, and
 * {@link LANGUAGE_PLACEHOLDER} takes the listed tag; without a list it takes
 * the post's. The one place the URL is decided, so the theme's link, the
 * webmention and the stored copy's key cannot disagree.
 */
export function selectedTargets(
  document: Pick<Document, 'tags' | 'extra'>,
  targets: readonly SyndicationTarget[],
  siteLanguage: string,
): SyndicationTarget[] {
  const listed = new Set(stringsOf(document.extra[SYNDICATE_TO_FRONT_MATTER_KEY]));
  const tags = new Set(document.tags.map((tag) => tag.toLowerCase()));
  const language = documentLanguage(document) ?? canonicalLocale(siteLanguage) ?? DEFAULT_LOCALE;

  return targets.flatMap((target) => {
    const selected =
      listed.has(target.id) || (target.tag !== undefined && tags.has(target.tag.toLowerCase()));
    if (!selected) return [];
    const filled =
      target.languages === undefined ? language : matchingLanguage(language, target.languages);
    if (filled === undefined) return [];
    if (!target.url.includes(LANGUAGE_PLACEHOLDER)) return [target];
    const url = webUrl(fillLanguage(target.url, filled));
    return url === undefined ? [] : [{ ...target, url }];
  });
}

/** The first of `languages` that `language` is, or is a regional form of. */
function matchingLanguage(language: string, languages: readonly string[]): string | undefined {
  const wanted = language.toLowerCase();
  return languages.find((tag) => {
    const listed = tag.toLowerCase();
    return wanted === listed || wanted.startsWith(`${listed}-`);
  });
}

function fillLanguage(template: string, language: string): string {
  return template.replaceAll(LANGUAGE_PLACEHOLDER, encodeURIComponent(language));
}

/** The ids a post's `syndicate-to` lists, as written. */
export function syndicateToOf(extra: Record<string, unknown>): string[] {
  return stringsOf(extra[SYNDICATE_TO_FRONT_MATTER_KEY]);
}

/** The copies an author listed by hand under `syndication`, each an http or https URL. */
export function handSyndicationOf(extra: Record<string, unknown>): string[] {
  return stringsOf(extra[SYNDICATION_FRONT_MATTER_KEY]).flatMap((value) => webUrl(value) ?? []);
}

/** The copies targets answered with, kept in {@link SYNDICATION_FILE}. */
export interface SyndicationCopies {
  /** The copies one post has, by the target URL that made each. Never touches the network. */
  read(permalink: string): Readonly<Record<string, string>>;
  /** Set or, with `undefined`, remove one target's copy of one post. */
  write(permalink: string, target: string, copy: string | undefined): Promise<void>;
  /** Forget every copy of a post, as when it moves to another permalink. */
  forget(permalink: string): Promise<void>;
}

/** The copies file of one content directory. */
export function syndicationCopies(contentDir: string): SyndicationCopies {
  const file = path.join(contentDir, ...SYNDICATION_FILE.split('/'));
  let cachedText: string | undefined;
  let cached: Record<string, Record<string, string>> = {};

  function readAll(): Record<string, Record<string, string>> {
    const text = readFileIfPresentSync(file);
    if (text === undefined) {
      cachedText = undefined;
      cached = {};
    } else if (text !== cachedText) {
      cachedText = text;
      cached = parseCopies(text);
    }
    return cached;
  }

  /**
   * Change the file under its lock, and write it only when something changed:
   * a resend that gets the same copy back must not churn a file that is in the
   * site's git history.
   */
  function update(change: (all: Record<string, Record<string, string>>) => boolean): Promise<void> {
    return withFileLock(file, () => {
      const current = readFileIfPresentSync(file);
      const all = current === undefined ? {} : parseCopies(current);
      if (change(all)) writeFileAtomicallySync(file, `${JSON.stringify(all, null, 2)}\n`);
    });
  }

  return {
    read(permalink) {
      return readAll()[permalink] ?? {};
    },

    write(permalink, target, copy) {
      return update((all) => {
        const copies = { ...all[permalink] };
        if (copies[target] === copy) return false;
        if (copy === undefined) delete copies[target];
        else copies[target] = copy;
        if (Object.keys(copies).length === 0) delete all[permalink];
        else all[permalink] = copies;
        return true;
      });
    },

    forget(permalink) {
      return update((all) => {
        if (!(permalink in all)) return false;
        delete all[permalink];
        return true;
      });
    },
  };
}

/**
 * The copies file's entries, each checked, since a person may edit it by hand.
 * An entry that is not a URL is dropped rather than failing a render.
 */
function parseCopies(text: string): Record<string, Record<string, string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};

  const all: Record<string, Record<string, string>> = {};
  for (const [permalink, value] of Object.entries(parsed)) {
    if (!isRecord(value)) continue;
    const copies: Record<string, string> = {};
    for (const [target, copy] of Object.entries(value)) {
      const href = webUrl(copy);
      if (href !== undefined) copies[target] = href;
    }
    if (Object.keys(copies).length > 0) all[permalink] = copies;
  }
  return all;
}

/** A front matter value as a list of strings: a lone string is a list of one. */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item !== '');
}

function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
