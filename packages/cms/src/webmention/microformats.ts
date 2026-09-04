import { classesOf, elementsIn, innerHtmlOf, isElement, parseHtml, textOf } from './html.ts';
import type { HtmlElement } from './html.ts';

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
}

/** The attributes that make an element a link to somewhere. */
const LINK_ATTRIBUTES: readonly string[] = ['href', 'src', 'data', 'poster', 'cite'];

/**
 * Whether a source page really links to the target.
 *
 * This is verification, and it is deliberately about links rather than about
 * text: a page that merely writes the target's address out is not talking to
 * it, and one that links to it in an `<img>`, a `<video>` or a `<link>` is.
 * The comparison is on the whole URL after both sides are resolved and
 * normalised, so a link written relative counts and a link to a different page
 * on the same site does not.
 */
export function linksTo(html: string, sourceUrl: string, target: string): boolean {
  const root = parseHtml(html);
  const base = baseOf(root, sourceUrl);
  const wanted = normalize(target, target);
  if (wanted === undefined) return false;

  return linkedFrom(root, base).has(wanted);
}

/** Every URL an element and everything under it links to, normalised. */
function linkedFrom(root: HtmlElement, base: string): Set<string> {
  const found = new Set<string>();

  for (const element of elementsIn(root)) {
    for (const attribute of LINK_ATTRIBUTES) {
      const value = element.attributes[attribute];
      if (value === undefined) continue;
      const resolved = normalize(value, base);
      if (resolved !== undefined) found.add(resolved);
    }
  }

  return found;
}

/**
 * What a source page is, read out of its microformats.
 *
 * The entry chosen is the one that is actually about the target: the first
 * `h-entry` whose `in-reply-to`, `like-of` or `repost-of` names it, else the
 * first that links to it at all, else the first on the page. A page with no
 * `h-entry` is still a mention — plenty of pages have no microformats and
 * still link — and it is described from its `<title>` and its host.
 */
export function sourceEntry(html: string, sourceUrl: string, target: string): SourceEntry {
  const root = parseHtml(html);
  const base = baseOf(root, sourceUrl);
  const items = itemsIn(root, base);
  const entries = itemsOfType(items, 'h-entry');
  const wanted = normalize(target, target);

  const chosen = chooseEntry(entries, wanted, base);
  const author = authorOf(chosen, items, sourceUrl);
  const content = contentOf(chosen, root);

  return {
    kind: chosen === undefined ? 'mention' : kindOf(chosen, wanted),
    author,
    content,
    published: chosen === undefined ? null : instantOf(first(chosen, 'published')),
    url: (chosen === undefined ? undefined : first(chosen, 'url')?.text) ?? sourceUrl,
  };
}

/** The entry a webmention is about, or `undefined` when the page has none. */
function chooseEntry(
  entries: readonly MicroformatItem[],
  target: string | undefined,
  base: string,
): MicroformatItem | undefined {
  if (target !== undefined) {
    for (const entry of entries) {
      if (kindOf(entry, target) !== 'mention') return entry;
    }
    for (const entry of entries) {
      if (linkedFrom(entry.element, base).has(target)) return entry;
    }
  }

  return entries[0];
}

/** Which of the four an entry is, given what the target is. */
function kindOf(entry: MicroformatItem, target: string | undefined): WebmentionKind {
  if (target === undefined) return 'mention';

  for (const [property, kind] of Object.entries(KIND_PROPERTIES)) {
    for (const value of entry.properties[property] ?? []) {
      if (value.text === target) return kind;
      // A property written as a nested `h-cite` names the target with its own
      // `url` rather than with the value the property carries.
      if (value.item !== undefined && first(value.item, 'url')?.text === target) return kind;
    }
  }

  return 'mention';
}

/**
 * Who wrote an entry.
 *
 * The entry's own `p-author` first, then a representative `h-card` on the page,
 * then the source's host — which is not a name but is the truest thing the site
 * knows, and is better on a page than an empty byline.
 */
function authorOf(
  entry: MicroformatItem | undefined,
  items: readonly MicroformatItem[],
  sourceUrl: string,
): SourceEntry['author'] {
  const named = entry === undefined ? undefined : first(entry, 'author');

  if (named?.item !== undefined) return cardOf(named.item);
  if (named !== undefined && named.text !== '') {
    return { name: named.text, url: null, photo: null };
  }

  const card = itemsOfType(items, 'h-card')[0];
  if (card !== undefined) {
    const read = cardOf(card);
    if (read.name !== '') return read;
  }

  return { name: hostOf(sourceUrl), url: null, photo: null };
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

/** A `dt-published` as an ISO instant, or `null` when it is not a date. */
function instantOf(value: MicroformatValue | undefined): string | null {
  if (value === undefined || value.text === '') return null;

  const at = new Date(value.text);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
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
  /** The markup, for an `e-` property. */
  readonly html?: string;
  /** The microformat the value was, when it was one. */
  readonly item?: MicroformatItem;
}

/** The first value of one property, or `undefined`. */
function first(item: MicroformatItem, property: string): MicroformatValue | undefined {
  return item.properties[property]?.[0];
}

/** Every item of one type, at any depth. */
function itemsOfType(items: readonly MicroformatItem[], type: string): MicroformatItem[] {
  const found: MicroformatItem[] = [];

  for (const item of items) {
    if (item.types.includes(type)) found.push(item);
    found.push(...itemsOfType(item.children, type));
    for (const values of Object.values(item.properties)) {
      for (const value of values) {
        if (value.item !== undefined) found.push(...itemsOfType([value.item], type));
      }
    }
  }

  return found;
}

/** The microformats at the top of a page: roots that are inside no other root. */
export function itemsIn(root: HtmlElement, base: string): MicroformatItem[] {
  const items: MicroformatItem[] = [];

  const walk = (element: HtmlElement): void => {
    for (const child of element.children) {
      if (!isElement(child)) continue;
      if (rootTypesOf(child).length > 0) items.push(parseItem(child, base));
      else walk(child);
    }
  };

  walk(root);
  return items;
}

/** The `h-*` classes an element carries. */
function rootTypesOf(element: HtmlElement): string[] {
  return classesOf(element).filter((name) => name.startsWith('h-') && name.length > 2);
}

/** The property classes an element carries, as `{prefix, name}` pairs. */
function propertiesOf(element: HtmlElement): { prefix: string; name: string }[] {
  const found: { prefix: string; name: string }[] = [];

  for (const value of classesOf(element)) {
    const match = /^(p|u|e|dt)-(.+)$/.exec(value);
    if (match !== null) found.push({ prefix: match[1] ?? '', name: match[2] ?? '' });
  }

  return found;
}

/**
 * One microformat, with the properties written inside it.
 *
 * The walk stops at a nested root: an `h-card` inside an `h-entry` is a value
 * of the entry, and the card's own `p-name` is the card's rather than the
 * entry's. That one rule is what keeps an author's name out of the entry's
 * title.
 */
function parseItem(element: HtmlElement, base: string): MicroformatItem {
  const properties: Record<string, MicroformatValue[]> = {};
  const children: MicroformatItem[] = [];

  const add = (name: string, value: MicroformatValue): void => {
    (properties[name] ??= []).push(value);
  };

  const walk = (parent: HtmlElement): void => {
    for (const child of parent.children) {
      if (!isElement(child)) continue;

      const roots = rootTypesOf(child);
      const named = propertiesOf(child);

      if (roots.length > 0) {
        const nested = parseItem(child, base);
        if (named.length === 0) children.push(nested);
        else {
          for (const { prefix, name } of named) {
            add(name, { text: nestedText(prefix, nested, child, base), item: nested });
          }
        }
        continue;
      }

      for (const { prefix, name } of named) add(name, valueOf(prefix, child, base));
      walk(child);
    }
  };

  walk(element);
  implied(element, properties, base);
  return { types: rootTypesOf(element), properties, children, element };
}

/** What a nested microformat is worth as a value of the property holding it. */
function nestedText(
  prefix: string,
  item: MicroformatItem,
  element: HtmlElement,
  base: string,
): string {
  if (prefix === 'u') return first(item, 'url')?.text ?? valueOf('u', element, base).text;
  return first(item, 'name')?.text ?? textOf(element);
}

/** One element as the value of one property. */
function valueOf(prefix: string, element: HtmlElement, base: string): MicroformatValue {
  const attributes = element.attributes;

  if (prefix === 'u') {
    const raw =
      attributeFor(element, ['a', 'area', 'link'], 'href') ??
      attributeFor(element, ['img', 'audio', 'video', 'source', 'iframe'], 'src') ??
      attributeFor(element, ['object'], 'data') ??
      attributeFor(element, ['video'], 'poster') ??
      attributeFor(element, ['data'], 'value') ??
      textOf(element);
    return { text: normalize(raw, base) ?? raw.trim() };
  }

  if (prefix === 'dt') {
    return {
      text:
        attributeFor(element, ['time', 'ins', 'del'], 'datetime') ??
        attributeFor(element, ['abbr'], 'title') ??
        attributeFor(element, ['data'], 'value') ??
        textOf(element),
    };
  }

  if (prefix === 'e') return { text: textOf(element), html: innerHtmlOf(element) };

  return {
    text:
      attributeFor(element, ['img', 'area'], 'alt') ??
      attributeFor(element, ['abbr'], 'title') ??
      attributeFor(element, ['data', 'input'], 'value') ??
      (element.name === 'meta' ? attributes['content'] : undefined) ??
      textOf(element),
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
 * actually arrives in and stops short of guessing.
 */
function implied(
  element: HtmlElement,
  properties: Record<string, MicroformatValue[]>,
  base: string,
): void {
  if (properties['name'] === undefined) {
    const name =
      attributeFor(element, ['img', 'area'], 'alt') ??
      attributeFor(element, ['abbr'], 'title') ??
      textOf(element);
    if (name !== '') properties['name'] = [{ text: name }];
  }

  if (properties['url'] === undefined) {
    const href =
      attributeFor(element, ['a', 'area', 'link'], 'href') ??
      onlyAttribute(element, ['a', 'area', 'link'], 'href');
    const url = href === undefined ? undefined : normalize(href, base);
    if (url !== undefined) properties['url'] = [{ text: url }];
  }

  if (properties['photo'] === undefined) {
    const src = attributeFor(element, ['img'], 'src') ?? onlyAttribute(element, ['img'], 'src');
    const photo = src === undefined ? undefined : normalize(src, base);
    if (photo !== undefined) properties['photo'] = [{ text: photo }];
  }
}

/**
 * The attribute of the one such element inside this one, when there is exactly
 * one and it is not a microformat of its own.
 *
 * Exactly one, because two links inside a card give no reason to prefer
 * either, and a guess in a byline is worse than an empty one.
 */
function onlyAttribute(
  element: HtmlElement,
  names: readonly string[],
  attribute: string,
): string | undefined {
  let found: string | undefined;

  for (const candidate of elementsIn(element)) {
    if (!names.includes(candidate.name)) continue;
    if (rootTypesOf(candidate).length > 0) continue;
    const value = candidate.attributes[attribute];
    if (value === undefined) continue;
    if (found !== undefined) return undefined;
    found = value;
  }

  return found;
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
