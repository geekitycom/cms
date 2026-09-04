/**
 * Somebody else's page, as a tree small enough to ask questions of.
 *
 * A webmention is a claim about a page this site does not control, and both
 * halves of checking it are questions about that page's markup: does it link
 * to the target, and what do its microformats say. Neither can be answered by
 * a regular expression over the source — a `class` list, an `href` and the
 * text of an element are all nested facts — so the source is read once into a
 * tree and asked afterwards.
 *
 * It is deliberately not a conforming HTML parser and never will be. It has no
 * table foster-parenting, no adoption agency, no character encoding detection:
 * what it has is elements, attributes and text, nested the way a page that is
 * not broken nests them, which is what {@link elementsIn} and
 * {@link textOf} need. `web/sanitize.ts` scans markup with the same shape of
 * scanner for a different job — it rebuilds output rather than building a
 * tree — and the two are kept apart rather than shared because one of them is
 * a security boundary and should not grow features for the other's sake.
 */

/** One element of a parsed page. */
export interface HtmlElement {
  /** Its tag name, lower-cased. */
  readonly name: string;
  /** Its attributes, names lower-cased and values with entities resolved. */
  readonly attributes: Readonly<Record<string, string>>;
  /** What is inside it, in document order. */
  readonly children: HtmlNode[];
}

/** A run of text between tags, with its character references resolved. */
export interface HtmlText {
  /** The text itself. */
  readonly text: string;
}

/** Either of the two things a tree is made of. */
export type HtmlNode = HtmlElement | HtmlText;

/** Whether a node is an element rather than a run of text. */
export function isElement(node: HtmlNode): node is HtmlElement {
  return 'name' in node;
}

/** Elements with no content of their own, so nothing ever closes them. */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Elements whose content is not markup.
 *
 * A `<` inside one of them is a character in a program or a stylesheet, so
 * everything up to the closing tag is skipped rather than parsed. Their text
 * is dropped as well: an author name taken out of a script is not an author
 * name.
 */
const RAW_TEXT: ReadonlySet<string> = new Set(['script', 'style']);

/**
 * Elements an opening tag of the same name implicitly closes.
 *
 * Without this, a page written as `<p>one<p>two` would nest, and an `h-entry`
 * looking for the properties directly inside it would find the second
 * paragraph inside the first.
 */
const CLOSED_BY_ITSELF: ReadonlySet<string> = new Set([
  'p',
  'li',
  'dt',
  'dd',
  'option',
  'tr',
  'td',
  'th',
]);

/** One tag, as the scanner reads it off the source. */
interface Tag {
  /** Lower-cased element name. */
  name: string;
  /** Whether it is a closing tag. */
  closing: boolean;
  /** Its attributes, names lower-cased. */
  attributes: Record<string, string>;
  /** Where the source continues after it. */
  end: number;
}

/**
 * A page as a tree, under one synthetic root standing for the document.
 *
 * Nothing throws. Markup this scanner cannot make sense of contributes
 * whatever it can and no more, because the alternative — refusing a page — is
 * refusing a webmention over somebody else's typo.
 */
export function parseHtml(source: string): HtmlElement {
  const root: HtmlElement = { name: '#document', attributes: {}, children: [] };
  const open: HtmlElement[] = [root];
  let at = 0;

  /** Where a node goes: inside the innermost element still open. */
  function current(): HtmlElement {
    return open[open.length - 1] ?? root;
  }

  /** Close open elements down to and including `name`, if it is open at all. */
  function closeThrough(name: string): void {
    const index = open.findLastIndex((element) => element.name === name);
    // Never the root, which nothing closes.
    if (index > 0) open.length = index;
  }

  while (at < source.length) {
    const next = source.indexOf('<', at);
    if (next < 0) {
      pushText(current(), source.slice(at));
      break;
    }
    if (next > at) pushText(current(), source.slice(at, next));
    at = next;

    if (source.startsWith('<!--', at)) {
      at = after(source, '-->', at);
      continue;
    }
    if (source.startsWith('<!', at) || source.startsWith('<?', at)) {
      at = after(source, '>', at);
      continue;
    }

    const tag = readTag(source, at);
    if (tag === undefined) {
      // A `<` that begins no tag is a character somebody typed.
      pushText(current(), '<');
      at += 1;
      continue;
    }
    at = tag.end;

    if (tag.closing) {
      closeThrough(tag.name);
      continue;
    }

    if (RAW_TEXT.has(tag.name)) {
      at = afterElement(source, tag.name, at);
      continue;
    }

    if (CLOSED_BY_ITSELF.has(tag.name) && current().name === tag.name) closeThrough(tag.name);

    const element: HtmlElement = { name: tag.name, attributes: tag.attributes, children: [] };
    current().children.push(element);
    if (!VOID_ELEMENTS.has(tag.name)) open.push(element);
  }

  return root;
}

/** Every element under `root`, itself excluded, in document order. */
export function* elementsIn(root: HtmlElement): Generator<HtmlElement> {
  for (const child of root.children) {
    if (!isElement(child)) continue;
    yield child;
    yield* elementsIn(child);
  }
}

/**
 * The text an element holds, everything nested in it included, with runs of
 * whitespace collapsed.
 *
 * Collapsed because it is read as a name or a title, and a page that wrote one
 * across three indented lines meant one line.
 */
export function textOf(node: HtmlNode): string {
  return rawTextOf(node).replace(/\s+/g, ' ').trim();
}

/** The text an element holds, exactly as the page spelled it. */
export function rawTextOf(node: HtmlNode): string {
  if (!isElement(node)) return node.text;
  return node.children.map(rawTextOf).join('');
}

/**
 * An element's inner markup, rebuilt from the tree.
 *
 * Rebuilt rather than sliced out of the source because the tree is what this
 * module trusts: an unclosed element in the page cannot leave a stray closing
 * tag in the result. It goes through `sanitizeCommentHtml` before it is stored
 * either way, so this only has to be close enough for that to read.
 */
export function innerHtmlOf(element: HtmlElement): string {
  return element.children.map(markupOf).join('');
}

/** One node as markup. */
function markupOf(node: HtmlNode): string {
  if (!isElement(node)) return escapeText(node.text);

  const attributes = Object.entries(node.attributes)
    .map(([name, value]) => ` ${name}="${escapeText(value)}"`)
    .join('');
  if (VOID_ELEMENTS.has(node.name)) return `<${node.name}${attributes}>`;
  return `<${node.name}${attributes}>${innerHtmlOf(node)}</${node.name}>`;
}

/** The classes an element carries, in the order it wrote them. */
export function classesOf(element: HtmlElement): string[] {
  const value = element.attributes['class'];
  return value === undefined ? [] : value.split(/\s+/).filter((name) => name !== '');
}

/** Whether an element's `rel` names this link relation. */
export function hasRel(element: HtmlElement, relation: string): boolean {
  const value = element.attributes['rel'];
  if (value === undefined) return false;
  return value.split(/\s+/).some((token) => token.toLowerCase() === relation);
}

/** Add a run of text, unless it is nothing at all. */
function pushText(parent: HtmlElement, text: string): void {
  if (text === '') return;
  parent.children.push({ text: decodeEntities(text) });
}

/** Where the source continues after the next `marker`, or its end. */
function after(source: string, marker: string, at: number): number {
  const end = source.indexOf(marker, at);
  return end < 0 ? source.length : end + marker.length;
}

/** Where the source continues after this element's closing tag, or its end. */
function afterElement(source: string, name: string, at: number): number {
  const closing = new RegExp(`</${name}\\s*>`, 'i');
  const match = closing.exec(source.slice(at));
  return match === null ? source.length : at + match.index + match[0].length;
}

/** The tag beginning at `at`, or `undefined` when nothing there is a tag. */
function readTag(source: string, at: number): Tag | undefined {
  const match = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(source.slice(at));
  if (match === null) return undefined;

  const name = (match[2] ?? '').toLowerCase();
  const closing = match[1] === '/';
  const attributes: Record<string, string> = {};
  let cursor = at + match[0].length;

  for (;;) {
    while (cursor < source.length && /\s/.test(source[cursor] ?? '')) cursor += 1;
    if (cursor >= source.length) return { name, closing, attributes, end: source.length };
    if (source.startsWith('/>', cursor)) return { name, closing, attributes, end: cursor + 2 };
    if (source[cursor] === '>') return { name, closing, attributes, end: cursor + 1 };

    const attribute = /^([^\s/>=]+)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/.exec(source.slice(cursor));
    if (attribute === null) {
      // Nothing that could be an attribute and no `>`: the tag is malformed,
      // so it ends where the source does.
      return { name, closing, attributes, end: source.length };
    }
    const raw = attribute[3];
    attributes[(attribute[1] ?? '').toLowerCase()] =
      raw === undefined ? '' : decodeEntities(unquote(raw));
    cursor += attribute[0].length;
  }
}

/** An attribute value with its quotes, if any, taken off. */
function unquote(value: string): string {
  const first = value[0];
  return (first === '"' || first === "'") && value.endsWith(first) ? value.slice(1, -1) : value;
}

/** The character references this module resolves. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Character references resolved; one this module does not know is left alone. */
function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;

  return value.replace(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g,
    (whole, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) {
        return codePoint(Number.parseInt(body.slice(2), 16)) ?? whole;
      }
      if (body.startsWith('#')) return codePoint(Number.parseInt(body.slice(1), 10)) ?? whole;
      return ENTITIES[body] ?? whole;
    },
  );
}

/** One code point as a string, or `undefined` when it names no character. */
function codePoint(value: number): string | undefined {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return undefined;
  if (value >= 0xd800 && value <= 0xdfff) return undefined;
  try {
    return String.fromCodePoint(value);
  } catch {
    return undefined;
  }
}

/** Text as markup again, so a rebuilt fragment says what the page said. */
function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
