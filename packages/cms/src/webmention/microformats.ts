import { isWebUrl } from '../content/enclosure.ts';
import { rsvpValue } from '../content/rsvp.ts';
import type { RsvpValue } from '../content/rsvp.ts';
import {
  classesOf,
  elementsIn,
  innerHtmlOf,
  isElement,
  parseHtml,
  textOf,
} from '../util/html-tree.ts';
import type { HtmlElement } from '../util/html-tree.ts';

/**
 * What somebody else's page says about this one.
 *
 * Two questions, and the receiver asks them in this order: does the source
 * really link to the target ({@link linksTo}, which is the whole of what
 * verification means), and if it does, what is it — a reply, a like, a repost
 * or a plain mention — and who wrote it ({@link sourceEntry}).
 *
 * The second question is microformats2, of which this reads a deliberate
 * subset: `h-entry` and `h-card`, the four properties that say what a mention
 * is, and the four that say who and what and when. A full mf2 parser —
 * `microformats-parser` is the usual one, MIT, and it pulls `parse5` with it —
 * implements nested items, backcompat with classic `hentry`, `rel-urls`,
 * implied properties in all their detail and the value-class pattern, none of
 * which changes what ends up in a comment file. The subset here is around two
 * hundred lines against a dependency tree, so it is the subset.
 *
 * Everything it reads is a stranger's markup, so nothing here throws and
 * nothing it returns is trusted: the HTML goes through `sanitizeCommentHtml`
 * before it is stored, and every URL is resolved and re-serialised.
 */

/** What kind of thing a source page is, as far as the target is concerned. */
export type WebmentionKind = 'reply' | 'like' | 'repost' | 'mention';

/** The property whose value naming the target makes a mention that kind. */
const KIND_PROPERTIES: Readonly<Record<string, WebmentionKind>> = {
  'in-reply-to': 'reply',
  'like-of': 'like',
  'repost-of': 'repost',
};

/** What a source page turned out to be. */
export interface SourceEntry {
  /** Which of the four it is. */
  readonly kind: WebmentionKind;
  /** Who wrote it, as far as the page says. */
  readonly author: {
    /** Their name, or the source's host when the page never gives one. */
    readonly name: string;
    /** Their own page, or `null`. */
    readonly url: string | null;
    /** Their avatar, or `null`. */
    readonly photo: string | null;
  };
  /** What it says. */
  readonly content: {
    /** The markup of its `e-content`, **unsanitised**, or empty. */
    readonly html: string;
    /** The same as text, or the page's title when it has no content at all. */
    readonly text: string;
  };
  /** When it says it was published, as an ISO 8601 instant, or `null`. */
  readonly published: string | null;
  /** Where it lives: its own `u-url`, else the URL it was fetched from. */
  readonly url: string;
  /** A reply's `p-rsvp`, when it is one of the four values. */
  readonly rsvp?: RsvpValue;
  /** Everything its `in-reply-to` names, a nested `h-cite` by its `url`. */
  readonly inReplyTo: readonly string[];
  /** The replies its page shows inside it, which a salmention carries. */
  readonly replies: readonly NestedReply[];
}

/** A reply printed inside another entry, with its own page, and the replies under it. */
export interface NestedReply {
  /** Its own page, which is its identity: one with none is not read. */
  readonly url: string;
  readonly author: SourceEntry['author'];
  /** Its `e-content`, **unsanitised**, or its summary or name as text. */
  readonly content: SourceEntry['content'];
  /** When it says it was published, as an ISO 8601 instant, or `null`. */
  readonly published: string | null;
  readonly replies: readonly NestedReply[];
}

/**
 * How deep and how many nested replies are read off one page. A stranger's
 * page is as long as they like, and a thread is rarely more than a few deep.
 */
const NESTED_DEPTH = 8;
const NESTED_LIMIT = 200;

/**
 * How many microformats are read off one page, nested ones counted. A blog's
 * front page carries a few hundred at most; anything past this is passed over.
 */
export const MICROFORMAT_ITEMS_PER_PAGE = 1_000;

/**
 * How many characters of one value's text, or of its markup, are kept. A reply
 * is a few paragraphs; a page that sends more is cut short here.
 */
export const MICROFORMAT_VALUE_LENGTH = 65_536;

/**
 * How many of an entry's `in-reply-to` values are kept. A reply answers one
 * thing, or a few; each one kept is looked for in the post's conversation.
 */
const IN_REPLY_TO_PER_ENTRY = 8;

/** How many property classes are read off one element. */
const PROPERTIES_PER_ELEMENT = 16;

/** The attributes that make an element a link to somewhere. */
const LINK_ATTRIBUTES: readonly string[] = ['href', 'src', 'data', 'poster', 'cite'];

/**
 * Whether a source page really links to the target.
 *
 * This is verification, and it is deliberately about links rather than about
 * text: a page that merely writes the target's address out is not talking to
 * it, and one that links to it in an `<img>`, a `<video>` or a `<link>` is.
 * The comparison is on the whole URL after both sides are resolved and
 * normalised, less any fragment, so a link written relative or to an anchor on
 * the page counts and a link to a different page on the same site does not.
 */
export function linksTo(html: string, sourceUrl: string, target: string): boolean {
  const root = parseHtml(html);
  const base = baseOf(root, sourceUrl);
  const resolved = normalize(target, target);
  if (resolved === undefined) return false;
  const wanted = withoutFragment(resolved);

  return linkedFrom(root, base).has(wanted);
}

/** Every URL a source page links to, resolved and normalised as {@link linksTo} reads them. */
export function linksIn(html: string, sourceUrl: string): Set<string> {
  const root = parseHtml(html);
  return linkedFrom(root, baseOf(root, sourceUrl));
}

/** Every URL an element and everything under it links to, normalised. */
function linkedFrom(root: HtmlElement, base: string): Set<string> {
  const found = new Set<string>();

  for (const element of elementsIn(root)) {
    for (const attribute of LINK_ATTRIBUTES) {
      const value = element.attributes[attribute];
      if (value === undefined) continue;
      const resolved = normalize(value, base);
      if (resolved !== undefined) found.add(withoutFragment(resolved));
    }
  }

  return found;
}

/**
 * What a source page is, read out of its microformats.
 *
 * `isTarget` says whether a URL is the page being mentioned, which may answer
 * to more than one URL. The entry chosen is the one that is actually about
 * it: the first `h-entry` whose `in-reply-to`, `like-of` or `repost-of` names
 * it, else the first that links to it at all, else the first on the page. A
 * page with no `h-entry` is still a mention — plenty of pages have no
 * microformats and still link — and it is described from its `<title>` and
 * its host.
 */
export function sourceEntry(
  html: string,
  sourceUrl: string,
  isTarget: (url: string) => boolean,
  now: Date,
): SourceEntry {
  const root = parseHtml(html);
  const base = baseOf(root, sourceUrl);
  const items = itemsIn(root, base);
  const entries = itemsOfType(items, 'h-entry');

  const named = (url: string): boolean => isTarget(withoutFragment(url));
  const chosen = chooseEntry(root, entries, named, base);
  const author = authorOf(chosen, items, root, sourceUrl, base);
  const content = contentOf(chosen, root);

  const kind = chosen === undefined ? 'mention' : kindOf(chosen, named);
  const url = (chosen === undefined ? undefined : first(chosen, 'url')?.text) ?? sourceUrl;
  const rsvp =
    chosen === undefined || kind !== 'reply' ? undefined : rsvpValue(first(chosen, 'rsvp')?.text);
  return {
    kind,
    ...(rsvp === undefined ? {} : { rsvp }),
    author,
    content,
    published: chosen === undefined ? null : instantOf(first(chosen, 'published'), now),
    url,
    replies: chosen === undefined ? [] : nestedReplies(chosen, url, sourceUrl, now),
    inReplyTo:
      chosen === undefined
        ? []
        : (chosen.properties['in-reply-to'] ?? [])
            .map((value) =>
              value.item === undefined
                ? value.text
                : (first(value.item, 'url')?.text ?? value.text),
            )
            .filter((url) => url !== '')
            .filter((url, index, urls) => urls.indexOf(url) === index)
            .slice(0, IN_REPLY_TO_PER_ENTRY),
  };
}

/**
 * The replies an entry carries: its `p-comment` items, and the `h-entry` and
 * `h-cite` children that name it in their `in-reply-to`, each read the same
 * way in turn. A reply is known by its page, so one with no `u-url`, or one
 * already read on this page, is passed over.
 */
function nestedReplies(
  entry: MicroformatItem,
  url: string,
  sourceUrl: string,
  now: Date,
): NestedReply[] {
  const seen = new Set<string>([url, sourceUrl]);

  const read = (item: MicroformatItem, itsUrl: string, depth: number): NestedReply[] => {
    if (depth >= NESTED_DEPTH) return [];
    const answering = (child: MicroformatItem): boolean =>
      (child.types.includes('h-entry') || child.types.includes('h-cite')) &&
      (child.properties['in-reply-to'] ?? []).some((value) => value.text === itsUrl);
    const carried = [
      ...(item.properties['comment'] ?? []).flatMap((value) =>
        value.item === undefined ? [] : [value.item],
      ),
      ...item.children.filter(answering),
    ];

    const replies: NestedReply[] = [];
    for (const reply of carried) {
      const at = first(reply, 'url')?.text;
      if (at === undefined || !isWebUrl(at) || seen.has(at) || seen.size > NESTED_LIMIT) continue;
      seen.add(at);
      const author = first(reply, 'author');
      replies.push({
        url: at,
        author:
          author?.item !== undefined
            ? cardOf(author.item)
            : { name: author?.text ?? '', url: null, photo: null },
        content: nestedContent(reply),
        published: instantOf(first(reply, 'published'), now),
        replies: read(reply, at, depth + 1),
      });
    }
    return replies;
  };

  return read(entry, url, 0);
}

/** What a nested reply says: its content, else its summary or its name. */
function nestedContent(item: MicroformatItem): SourceEntry['content'] {
  const content = first(item, 'content');
  if (content !== undefined && (content.html ?? '') !== '') {
    return { html: content.html ?? '', text: content.text };
  }
  return { html: '', text: (first(item, 'summary') ?? first(item, 'name'))?.text ?? '' };
}

/** The first `h-entry` on a page, as the parts a citation of it shows. */
export interface CitedEntry {
  /** Its `p-name`, or empty. A note's name is often its whole text. */
  readonly name: string;
  /** Its `e-content` as text, or its `p-summary`, or empty. */
  readonly text: string;
  /** Who wrote it, when the entry says, with their page and avatar when it gives them. */
  readonly author:
    | { readonly name: string; readonly url: string | null; readonly photo: string | null }
    | undefined;
  /** When it says it was published, as an ISO 8601 instant, or `null`. */
  readonly published: string | null;
  /** Its `u-url` and `u-uid`, which a silo copy points at its original with. */
  readonly urls: readonly string[];
  /** Its `u-syndication`: the copies of it elsewhere. */
  readonly syndication: readonly string[];
}

/**
 * What the first `h-entry` on a parsed page says about itself, or `undefined`
 * when the page has none. Unlike {@link sourceEntry} nothing is filled in from
 * the page around it: a citation names who wrote a post only when the post
 * does. Only the author's avatar may come from elsewhere on the page, from an
 * `h-card` that is the same person: the same page, or the same name when the
 * entry's author has no page.
 */
export function citedEntry(root: HtmlElement, pageUrl: string): CitedEntry | undefined {
  const items = itemsIn(root, baseOf(root, pageUrl));
  const entry = itemsOfType(items, 'h-entry')[0];
  if (entry === undefined) return undefined;

  const author = first(entry, 'author');
  const card = author?.item === undefined ? undefined : cardOf(author.item);
  const authorName = card?.name ?? author?.text ?? '';
  const authorUrl = card?.url ?? null;
  const photo =
    card?.photo ??
    itemsOfType(items, 'h-card')
      .map(cardOf)
      .find(
        (other) =>
          other.photo !== null &&
          (authorUrl === null ? other.name === authorName : other.url === authorUrl),
      )?.photo ??
    null;

  return {
    name: first(entry, 'name')?.text ?? '',
    text: first(entry, 'content')?.text ?? first(entry, 'summary')?.text ?? '',
    author: authorName === '' ? undefined : { name: authorName, url: authorUrl, photo },
    published: instantOf(first(entry, 'published')),
    urls: [...valuesOf(entry, 'url'), ...valuesOf(entry, 'uid')],
    syndication: valuesOf(entry, 'syndication'),
  };
}

/** The first `h-event` on a page, as the parts an RSVP's citation of it shows. */
export interface CitedEvent {
  /** Its `p-name`, or empty. */
  readonly name: string;
  /** Its `p-summary`, `p-description` or `e-content` as text, or empty. */
  readonly text: string;
  /** Its `dt-start` as written, or empty. */
  readonly start: string;
  /** Its `p-location`: a place's name when it is an `h-card` or `h-adr`, else its text. */
  readonly location: string;
}

/** What the first `h-event` on a parsed page says about itself, or `undefined`. */
export function citedEvent(root: HtmlElement, pageUrl: string): CitedEvent | undefined {
  const event = itemsOfType(itemsIn(root, baseOf(root, pageUrl)), 'h-event')[0];
  if (event === undefined) return undefined;
  return {
    name: first(event, 'name')?.text ?? '',
    text:
      first(event, 'summary')?.text ??
      first(event, 'description')?.text ??
      first(event, 'content')?.text ??
      '',
    start: first(event, 'start')?.text ?? '',
    location: first(event, 'location')?.text ?? '',
  };
}

function valuesOf(item: MicroformatItem, property: string): string[] {
  return (item.properties[property] ?? []).map((value) => value.text).filter((text) => text !== '');
}

/** The entry a webmention is about, or `undefined` when the page has none. */
function chooseEntry(
  root: HtmlElement,
  entries: readonly MicroformatItem[],
  isTarget: (url: string) => boolean,
  base: string,
): MicroformatItem | undefined {
  for (const entry of entries) {
    if (kindOf(entry, isTarget) !== 'mention') return entry;
  }
  const linking = entriesLinkingTo(root, entries, isTarget, base);
  return entries.find((entry) => linking.has(entry.element)) ?? entries[0];
}

/**
 * The elements of those entries that have a link to the target somewhere
 * inside them, found in one walk of the page however deeply they nest.
 */
function entriesLinkingTo(
  root: HtmlElement,
  entries: readonly MicroformatItem[],
  isTarget: (url: string) => boolean,
  base: string,
): Set<HtmlElement> {
  const isEntry = new Set(entries.map((entry) => entry.element));
  const linking = new Set<HtmlElement>();
  const open: HtmlElement[] = [];
  const pending: { element: HtmlElement; leaving: boolean }[] = [{ element: root, leaving: false }];

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { element, leaving } = next;
    if (leaving) {
      open.pop();
      continue;
    }

    if (element !== root && linksToTarget(element, isTarget, base)) {
      for (let index = open.length - 1; index >= 0; index -= 1) {
        const enclosing = open[index] as HtmlElement;
        if (linking.has(enclosing)) break;
        linking.add(enclosing);
      }
    }

    if (isEntry.has(element)) {
      open.push(element);
      pending.push({ element, leaving: true });
    }
    for (let index = element.children.length - 1; index >= 0; index -= 1) {
      const child = element.children[index];
      if (child !== undefined && isElement(child)) pending.push({ element: child, leaving: false });
    }
  }

  return linking;
}

/** Whether one element, itself and not what is inside it, links to the target. */
function linksToTarget(
  element: HtmlElement,
  isTarget: (url: string) => boolean,
  base: string,
): boolean {
  return LINK_ATTRIBUTES.some((attribute) => {
    const value = element.attributes[attribute];
    const resolved = value === undefined ? undefined : normalize(value, base);
    return resolved !== undefined && isTarget(resolved);
  });
}

/** Which of the four an entry is, given what the target is. */
function kindOf(entry: MicroformatItem, isTarget: (url: string) => boolean): WebmentionKind {
  for (const [property, kind] of Object.entries(KIND_PROPERTIES)) {
    for (const value of entry.properties[property] ?? []) {
      if (isTarget(value.text)) return kind;
      // A property written as a nested `h-cite` names the target with its own
      // `url` rather than with the value the property carries.
      const cited = value.item === undefined ? undefined : first(value.item, 'url')?.text;
      if (cited !== undefined && isTarget(cited)) return kind;
    }
  }

  return 'mention';
}

/**
 * Who wrote an entry.
 *
 * The entry's own `p-author` first, then the `p-author` of the `h-feed` that
 * holds it, then the page's representative `h-card`, then the source's host —
 * which is not a name but is the truest thing the site knows, and is better on
 * a page than an empty byline.
 */
function authorOf(
  entry: MicroformatItem | undefined,
  items: readonly MicroformatItem[],
  root: HtmlElement,
  sourceUrl: string,
  base: string,
): SourceEntry['author'] {
  const feed =
    entry === undefined
      ? undefined
      : items.find((item) => item.types.includes('h-feed') && item.children.includes(entry));

  for (const holder of [entry, feed]) {
    const named = holder === undefined ? undefined : first(holder, 'author');
    if (named?.item !== undefined) return cardOf(named.item);
    if (named !== undefined && isWebUrl(named.text)) {
      const label = named.label ?? '';
      return {
        name: label === '' || isWebUrl(label) ? hostOf(named.text) : label,
        url: named.text,
        photo: null,
      };
    }
    if (named !== undefined && named.text !== '') {
      return { name: named.text, url: null, photo: null };
    }
  }

  const card = representativeCard(items, root, sourceUrl, base);
  if (card !== undefined) {
    const read = cardOf(card);
    if (read.name !== '') return read;
  }

  return { name: hostOf(sourceUrl), url: null, photo: null };
}

/**
 * The `h-card` that stands for the page's owner: one at the top of the page,
 * not inside an entry or a citation, whose `u-url` is the page itself or a
 * page it links `rel=me`.
 */
function representativeCard(
  items: readonly MicroformatItem[],
  root: HtmlElement,
  sourceUrl: string,
  base: string,
): MicroformatItem | undefined {
  const page = normalize(sourceUrl, sourceUrl);
  const me = relMeOf(root, base);
  return items.find(
    (item) =>
      item.types.includes('h-card') &&
      (item.properties['url'] ?? []).some((url) => url.text === page || me.has(url.text)),
  );
}

/** The pages a page links `rel=me`, resolved. */
function relMeOf(root: HtmlElement, base: string): Set<string> {
  const me = new Set<string>();
  for (const element of elementsIn(root)) {
    if (element.name !== 'a' && element.name !== 'link' && element.name !== 'area') continue;
    const rels = (element.attributes['rel'] ?? '').toLowerCase().split(/\s+/);
    if (!rels.includes('me')) continue;
    const href = normalize(element.attributes['href'] ?? '', base);
    if (href !== undefined) me.add(href);
  }
  return me;
}

/** One `h-card` as a name, a page and an avatar. */
function cardOf(card: MicroformatItem): SourceEntry['author'] {
  return {
    name: first(card, 'name')?.text ?? '',
    url: first(card, 'url')?.text ?? null,
    photo: first(card, 'photo')?.text ?? null,
  };
}

/** What an entry says, or the page's title when it says nothing. */
function contentOf(entry: MicroformatItem | undefined, root: HtmlElement): SourceEntry['content'] {
  const content = entry === undefined ? undefined : first(entry, 'content');
  if (content !== undefined && (content.html ?? '') !== '') {
    return { html: content.html ?? '', text: content.text };
  }

  const summary =
    entry === undefined ? undefined : (first(entry, 'summary') ?? first(entry, 'name'));
  if (summary !== undefined && summary.text !== '') return { html: '', text: summary.text };

  return { html: '', text: titleOf(root) };
}

/** The page's `<title>`, or an empty string. */
function titleOf(root: HtmlElement): string {
  for (const element of elementsIn(root)) {
    if (element.name === 'title') return textOf(element);
  }
  return '';
}

const DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;

const EARLIEST_PUBLISHED = Date.UTC(1990, 0, 1);

const PUBLISHED_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * A `dt-published` as an ISO instant, or `null` when it is not a date, is
 * older than the web, or is more than a day after `now`. A time with no
 * offset is UTC.
 */
function instantOf(value: MicroformatValue | undefined, now?: Date): string | null {
  const match = DATETIME.exec(value?.text.trim() ?? '');
  if (match === null) return null;

  const [
    ,
    year = '',
    month = '',
    day = '',
    hour = '0',
    minute = '0',
    second = '0',
    fraction = '',
    zone,
  ] = match;
  const y = Number(year);
  const mo = Number(month) - 1;
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);
  const local = Date.UTC(y, mo, d, h, mi, s, Number(fraction.padEnd(3, '0').slice(0, 3)));
  const date = new Date(local);
  const sameDay =
    date.getUTCFullYear() === y && date.getUTCMonth() === mo && date.getUTCDate() === d;
  if (!sameDay || h > 23 || mi > 59 || s > 59) return null;

  const offset = offsetMinutes(zone);
  if (offset === null) return null;
  const at = local - offset * 60 * 1000;
  if (at < EARLIEST_PUBLISHED) return null;
  if (now !== undefined && at > now.getTime() + PUBLISHED_CLOCK_SKEW_MS) return null;
  return new Date(at).toISOString();
}

function offsetMinutes(zone: string | undefined): number | null {
  if (zone === undefined || zone.toUpperCase() === 'Z') return 0;
  const hours = Number(zone.slice(1, 3));
  const minutes = Number(zone.slice(-2));
  if (hours > 23 || minutes > 59) return null;
  return (zone.startsWith('-') ? -1 : 1) * (hours * 60 + minutes);
}

/** The host a source is on, for a page that never says who wrote it. */
function hostOf(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).host;
  } catch {
    return sourceUrl;
  }
}

/** One microformat found on a page. */
export interface MicroformatItem {
  /** Its types: `h-entry`, `h-card` and so on. */
  readonly types: readonly string[];
  /** Its properties, each of which may have been written more than once. */
  readonly properties: Readonly<Record<string, MicroformatValue[]>>;
  /** The microformats inside it that are not properties of it. */
  readonly children: readonly MicroformatItem[];
  /** The element it was read off, for the questions the properties cannot answer. */
  readonly element: HtmlElement;
}

/** One value of one property. */
export interface MicroformatValue {
  /** The value as text, or as a URL for a `u-` property. */
  readonly text: string;
  /** The text a `u-` property's element shows, which can name the link. */
  readonly label?: string;
  /** The markup, for an `e-` property. */
  readonly html?: string;
  /** The microformat the value was, when it was one. */
  readonly item?: MicroformatItem;
}

/** The first value of one property, or `undefined`. */
function first(item: MicroformatItem, property: string): MicroformatValue | undefined {
  return item.properties[property]?.[0];
}

/**
 * Every item of one type, at any depth, in document order. One nested item can
 * be the value of several properties at once, and it is listed once.
 */
function itemsOfType(items: readonly MicroformatItem[], type: string): MicroformatItem[] {
  const found: MicroformatItem[] = [];
  const seen = new Set<MicroformatItem>();
  const pending = [...items].reverse();

  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    if (seen.has(item)) continue;
    seen.add(item);
    if (item.types.includes(type)) found.push(item);

    const inside = [
      ...item.children,
      ...Object.values(item.properties).flatMap((values) =>
        values.flatMap((value) => (value.item === undefined ? [] : [value.item])),
      ),
    ];
    for (let index = inside.length - 1; index >= 0; index -= 1) {
      pending.push(inside[index] as MicroformatItem);
    }
  }

  return found;
}

/** The microformats at the top of a page: roots that are inside no other root. */
export function itemsIn(root: HtmlElement, base: string): MicroformatItem[] {
  const items: MicroformatItem[] = [];
  const reading: Reading = {
    left: MICROFORMAT_ITEMS_PER_PAGE,
    texts: new Map(),
    markup: new Map(),
  };

  const walk = (element: HtmlElement): void => {
    for (const child of element.children) {
      if (!isElement(child)) continue;
      if (rootTypesOf(child).length === 0) walk(child);
      else if (reading.left > 0) items.push(parseItem(child, base, reading));
    }
  };

  walk(root);
  return items;
}

/** The `h-*` classes an element carries. */
function rootTypesOf(element: HtmlElement): string[] {
  return classesOf(element).filter((name) => name.startsWith('h-') && name.length > 2);
}

/**
 * The property classes an element carries, as `{prefix, name}` pairs, each
 * once and no more than {@link PROPERTIES_PER_ELEMENT} of them.
 */
function propertiesOf(element: HtmlElement): { prefix: string; name: string }[] {
  const found: { prefix: string; name: string }[] = [];
  const seen = new Set<string>();

  for (const value of classesOf(element)) {
    if (found.length >= PROPERTIES_PER_ELEMENT) break;
    const match = /^(p|u|e|dt)-(.+)$/.exec(value);
    if (match === null || seen.has(value)) continue;
    seen.add(value);
    found.push({ prefix: match[1] ?? '', name: match[2] ?? '' });
  }

  return found;
}

/**
 * One page as it is being read: how many more items it may yield, and the text
 * and markup of each element already read, which several properties can share.
 */
interface Reading {
  left: number;
  readonly texts: Map<HtmlElement, string>;
  readonly markup: Map<HtmlElement, string>;
}

/** An element's text, read once per page and no longer than a value is kept. */
function textIn(element: HtmlElement, reading: Reading): string {
  let text = reading.texts.get(element);
  if (text === undefined) {
    text = textOf(element, MICROFORMAT_VALUE_LENGTH);
    reading.texts.set(element, text);
  }
  return text;
}

/** An element's inner markup, read once per page and no longer than a value is kept. */
function markupIn(element: HtmlElement, base: string, reading: Reading): string {
  let markup = reading.markup.get(element);
  if (markup === undefined) {
    markup = innerHtmlOf(element, MICROFORMAT_VALUE_LENGTH, base);
    reading.markup.set(element, markup);
  }
  return markup;
}

/**
 * One microformat, with the properties written inside it.
 *
 * The walk stops at a nested root: an `h-card` inside an `h-entry` is a value
 * of the entry, and the card's own `p-name` is the card's rather than the
 * entry's. That one rule is what keeps an author's name out of the entry's
 * title.
 */
function parseItem(element: HtmlElement, base: string, reading: Reading): MicroformatItem {
  reading.left -= 1;
  const found = new Map<string, MicroformatValue[]>();
  const children: MicroformatItem[] = [];
  // Whether anything inside is a `p-` or `e-` property or a microformat of its
  // own, which is when mf2 stops implying a name from the whole text.
  let textual = false;

  const add = (name: string, value: MicroformatValue): void => {
    const values = found.get(name);
    if (values === undefined) found.set(name, [value]);
    else values.push(value);
  };

  const walk = (parent: HtmlElement): void => {
    for (const child of parent.children) {
      if (!isElement(child)) continue;

      const roots = rootTypesOf(child);
      const named = propertiesOf(child);

      if (roots.length > 0) {
        textual = true;
        if (reading.left <= 0) continue;
        const nested = parseItem(child, base, reading);
        if (named.length === 0) children.push(nested);
        else {
          for (const { prefix, name } of named) {
            add(name, { text: nestedText(prefix, nested, child, base, reading), item: nested });
          }
        }
        continue;
      }

      for (const { prefix, name } of named) {
        if (prefix === 'p' || prefix === 'e') textual = true;
        add(name, valueOf(prefix, child, base, reading));
      }
      walk(child);
    }
  };

  walk(element);
  const properties: Record<string, MicroformatValue[]> = Object.fromEntries(found);
  implied(element, properties, base, reading, !textual);
  return { types: rootTypesOf(element), properties, children, element };
}

/** What a nested microformat is worth as a value of the property holding it. */
function nestedText(
  prefix: string,
  item: MicroformatItem,
  element: HtmlElement,
  base: string,
  reading: Reading,
): string {
  if (prefix === 'u') return first(item, 'url')?.text ?? valueOf('u', element, base, reading).text;
  return first(item, 'name')?.text ?? textIn(element, reading);
}

/** One element as the value of one property. */
function valueOf(
  prefix: string,
  element: HtmlElement,
  base: string,
  reading: Reading,
): MicroformatValue {
  const attributes = element.attributes;

  if (prefix === 'u') {
    const raw =
      attributeFor(element, ['a', 'area', 'link'], 'href') ??
      attributeFor(element, ['img', 'audio', 'video', 'source', 'iframe'], 'src') ??
      attributeFor(element, ['object'], 'data') ??
      attributeFor(element, ['video'], 'poster') ??
      attributeFor(element, ['data'], 'value') ??
      textIn(element, reading);
    return { text: normalize(raw, base) ?? raw.trim(), label: textIn(element, reading) };
  }

  if (prefix === 'dt') {
    return {
      text:
        attributeFor(element, ['time', 'ins', 'del'], 'datetime') ??
        attributeFor(element, ['abbr'], 'title') ??
        attributeFor(element, ['data'], 'value') ??
        textIn(element, reading),
    };
  }

  if (prefix === 'e')
    return { text: textIn(element, reading), html: markupIn(element, base, reading) };

  return {
    text:
      attributeFor(element, ['img', 'area'], 'alt') ??
      attributeFor(element, ['abbr'], 'title') ??
      attributeFor(element, ['data', 'input'], 'value') ??
      (element.name === 'meta' ? attributes['content'] : undefined) ??
      textIn(element, reading),
  };
}

/** One attribute, when the element is one of these and carries it. */
function attributeFor(
  element: HtmlElement,
  names: readonly string[],
  attribute: string,
): string | undefined {
  if (!names.includes(element.name)) return undefined;
  return element.attributes[attribute];
}

/**
 * The name, the page and the avatar a microformat implies when it did not
 * spell them out.
 *
 * `<a class="h-card" href="https://ada.example/">Ada</a>` is the commonest
 * `h-card` on the web and says none of its three properties explicitly. The
 * full rules are longer than this; what is here covers the shapes a webmention
 * actually arrives in and stops short of guessing. A name is implied only when
 * nothing inside is a `p-` or `e-` property or a nested microformat, as mf2
 * says, so an entry with an `e-content` and no `p-name` has no name rather
 * than the text of everything around it.
 */
function implied(
  element: HtmlElement,
  properties: Record<string, MicroformatValue[]>,
  base: string,
  reading: Reading,
  impliesName: boolean,
): void {
  if (impliesName && properties['name'] === undefined) {
    const name =
      attributeFor(element, ['img', 'area'], 'alt') ??
      attributeFor(element, ['abbr'], 'title') ??
      textIn(element, reading);
    if (name !== '') properties['name'] = [{ text: name }];
  }

  if (properties['url'] === undefined) {
    const href =
      attributeFor(element, ['a', 'area', 'link'], 'href') ??
      impliedAttribute(element, ['a', 'area'], 'href');
    const url = href === undefined ? undefined : normalize(href, base);
    if (url !== undefined) properties['url'] = [{ text: url }];
  }

  if (properties['photo'] === undefined) {
    const src = attributeFor(element, ['img'], 'src') ?? impliedAttribute(element, ['img'], 'src');
    const photo = src === undefined ? undefined : normalize(src, base);
    if (photo !== undefined) properties['photo'] = [{ text: photo }];
  }
}

/**
 * The attribute an item implies from what is directly inside it, as mf2 reads
 * an implied `url` or `photo`: its only child of one of these types, else the
 * only child of that type of its only child element. Nothing that is a
 * microformat of its own counts, and nothing deeper is looked at.
 *
 * Only one of a type, because two links inside a card give no reason to prefer
 * either, and a guess in a byline is worse than an empty one.
 */
function impliedAttribute(
  element: HtmlElement,
  names: readonly string[],
  attribute: string,
): string | undefined {
  const sole = onlyChild(element);
  for (const parent of sole === undefined ? [element] : [element, sole]) {
    for (const name of names) {
      const value = onlyOfType(parent, name)?.attributes[attribute];
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

/** The one child element of this one, when it has exactly one and it is not a microformat. */
function onlyChild(element: HtmlElement): HtmlElement | undefined {
  return soleOf(element.children.filter(isElement));
}

/** The one child element of this name, when there is exactly one and it is not a microformat. */
function onlyOfType(element: HtmlElement, name: string): HtmlElement | undefined {
  return soleOf(
    element.children.filter(
      (child): child is HtmlElement => isElement(child) && child.name === name,
    ),
  );
}

/** The only element of these, unless there are more or it is a microformat. */
function soleOf(elements: readonly HtmlElement[]): HtmlElement | undefined {
  const [only] = elements;
  return elements.length === 1 && only !== undefined && rootTypesOf(only).length === 0
    ? only
    : undefined;
}

/** The `<base href>` a page declares, or the URL it was fetched from. */
function baseOf(root: HtmlElement, sourceUrl: string): string {
  for (const element of elementsIn(root)) {
    if (element.name !== 'base') continue;
    const href = element.attributes['href'];
    if (href === undefined) continue;
    const resolved = normalize(href, sourceUrl);
    if (resolved !== undefined) return resolved;
  }

  return sourceUrl;
}

function withoutFragment(url: string): string {
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}

/** One href as an absolute URL, or `undefined` when it is not one. */
function normalize(href: string, base: string): string | undefined {
  const trimmed = href.trim();
  if (trimmed === '') return undefined;

  try {
    return new URL(trimmed, base).href;
  } catch {
    return undefined;
  }
}
