/**
 * Sanitising the HTML a stranger wrote.
 *
 * A fediverse reply is markup composed on somebody else's server, and the
 * comments feeds republish it under this site's name. Nothing here trusts a
 * byte of it: the input is tokenised and the output is *rebuilt* from an
 * allowlist, so a tag, an attribute or an entity that this module does not
 * name cannot reach a reader however it was spelled. Text is decoded and
 * escaped again rather than copied, for the same reason.
 *
 * The allowlist is what a `Note` from Mastodon, GoToSocial, Misskey or
 * WordPress's own ActivityPub plugin is made of. Anything else — a `div`, a
 * `span`, an `img`, an unknown element — is unwrapped rather than deleted, so
 * a reader still sees what the comment said even when the markup around it is
 * gone.
 */

/** Elements kept, with the attributes each may keep. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  a: ['href'],
  b: [],
  blockquote: [],
  br: [],
  code: [],
  del: [],
  em: [],
  i: [],
  li: [],
  ol: [],
  p: [],
  pre: [],
  s: [],
  strong: [],
  u: [],
  ul: [],
};

/** Elements with no content of their own. */
const VOID_ELEMENTS: readonly string[] = ['br'];

/**
 * Elements dropped along with everything inside them.
 *
 * Their content is not text: it is a program or a stylesheet, and unwrapping
 * one would publish its source as if the commenter had written it.
 */
const DROPPED_WHOLE: readonly string[] = ['script', 'style'];

/**
 * Elements an opening tag of the same name implicitly closes, as HTML parsing
 * does. Without this a note written as `<p>one<p>two` would nest, and the
 * closing tags this module adds would put the second paragraph inside the
 * first.
 */
const CLOSED_BY_ITSELF: readonly string[] = ['p', 'li'];

/**
 * URL schemes a link may use.
 *
 * An allowlist rather than a `javascript:` denylist: `data:` and `vbscript:`
 * are as dangerous, and the next scheme somebody thinks of is not on any list
 * written today.
 */
const ALLOWED_SCHEMES: readonly string[] = ['http://', 'https://', 'mailto:'];

/**
 * What every kept link is marked with. A comment feed is user-submitted
 * content pointing at a stranger's site, which is exactly what `nofollow` is
 * for; the other two are what a reader rendering the feed in a browser needs.
 */
const LINK_REL = 'nofollow noopener noreferrer';

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

/** A stranger's HTML, reduced to markup this site is willing to republish. */
export function sanitizeCommentHtml(html: string): string {
  const out: string[] = [];
  /** The elements written and not yet closed, outermost first. */
  const open: string[] = [];
  let at = 0;

  /** Close open elements down to and including `name`, if it is open at all. */
  function closeThrough(name: string): boolean {
    const index = open.lastIndexOf(name);
    if (index < 0) return false;
    while (open.length > index) out.push(`</${open.pop() ?? ''}>`);
    return true;
  }

  while (at < html.length) {
    const next = html.indexOf('<', at);
    if (next < 0) {
      out.push(escapeText(html.slice(at)));
      break;
    }
    if (next > at) out.push(escapeText(html.slice(at, next)));
    at = next;

    if (html.startsWith('<!--', at)) {
      at = after(html, '-->', at);
      continue;
    }
    // A doctype, a processing instruction, or anything else that is not an
    // element: skipped to its `>`, contributing nothing.
    if (html.startsWith('<!', at) || html.startsWith('<?', at)) {
      at = after(html, '>', at);
      continue;
    }

    const tag = readTag(html, at);
    if (tag === undefined) {
      // A `<` that begins no tag is a character somebody typed.
      out.push('&lt;');
      at += 1;
      continue;
    }
    at = tag.end;

    if (tag.closing) {
      closeThrough(tag.name);
      continue;
    }

    if (DROPPED_WHOLE.includes(tag.name)) {
      at = afterElement(html, tag.name, at);
      continue;
    }

    const attributes = keptAttributes(tag);
    if (attributes === undefined) continue; // Unwrapped: its children stay.

    if (VOID_ELEMENTS.includes(tag.name)) {
      out.push(`<${tag.name}>`);
      continue;
    }

    if (CLOSED_BY_ITSELF.includes(tag.name)) closeThrough(tag.name);
    out.push(`<${tag.name}${attributes}>`);
    open.push(tag.name);
  }

  while (open.length > 0) out.push(`</${open.pop() ?? ''}>`);
  return out.join('');
}

/**
 * The attributes an element keeps, already spelled as markup, or `undefined`
 * when the element is not one to keep at all.
 *
 * A link whose target is not a scheme this module allows is not a link: it is
 * unwrapped, which leaves the words the commenter wrote and drops the address
 * they pointed at.
 */
function keptAttributes(tag: Tag): string | undefined {
  const allowed = ALLOWED[tag.name];
  if (allowed === undefined) return undefined;

  if (tag.name !== 'a') return '';

  const href = safeHref(tag.attributes['href']);
  if (href === undefined) return undefined;
  return ` href="${escapeText(href)}" rel="${LINK_REL}"`;
}

/** A link target, or `undefined` when it is not one this site will publish. */
function safeHref(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  // Control characters are dropped and the ends trimmed before the scheme is
  // read, because that is what a browser's URL parser does: `java&#10;script:`
  // is a script URL to everything that will render this.
  const href = [...decodeEntities(value)]
    .filter((character) => !isControl(character))
    .join('')
    .trim();
  const lowered = href.toLowerCase();
  return ALLOWED_SCHEMES.some((scheme) => lowered.startsWith(scheme)) ? href : undefined;
}

/** Whether a character is one a URL parser removes wherever it appears. */
function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
}

/** Where the source continues after the next `marker`, or its end. */
function after(html: string, marker: string, at: number): number {
  const end = html.indexOf(marker, at);
  return end < 0 ? html.length : end + marker.length;
}

/** Where the source continues after this element's closing tag, or its end. */
function afterElement(html: string, name: string, at: number): number {
  const closing = new RegExp(`</${name}\\s*>`, 'i');
  const rest = html.slice(at);
  const match = closing.exec(rest);
  return match === null ? html.length : at + match.index + match[0].length;
}

/** The tag beginning at `at`, or `undefined` when nothing there is a tag. */
function readTag(html: string, at: number): Tag | undefined {
  const match = /^<(\/?)([A-Za-z][A-Za-z0-9]*)/.exec(html.slice(at));
  if (match === null) return undefined;

  const name = (match[2] ?? '').toLowerCase();
  const closing = match[1] === '/';
  const attributes: Record<string, string> = {};
  let cursor = at + match[0].length;

  for (;;) {
    while (cursor < html.length && /\s/.test(html[cursor] ?? '')) cursor += 1;
    if (cursor >= html.length) return { name, closing, attributes, end: html.length };
    if (html.startsWith('/>', cursor)) return { name, closing, attributes, end: cursor + 2 };
    if (html[cursor] === '>') return { name, closing, attributes, end: cursor + 1 };

    const attribute = /^([^\s/>=]+)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/.exec(html.slice(cursor));
    if (attribute === null) {
      // Nothing that could be an attribute and no `>`: the tag is malformed,
      // so it ends where the source does.
      return { name, closing, attributes, end: html.length };
    }
    const raw = attribute[3];
    attributes[(attribute[1] ?? '').toLowerCase()] = raw === undefined ? '' : unquote(raw);
    cursor += attribute[0].length;
  }
}

/** An attribute value with its quotes, if any, taken off. */
function unquote(value: string): string {
  const first = value[0];
  return (first === '"' || first === "'") && value.endsWith(first) ? value.slice(1, -1) : value;
}

/** The character references this module resolves before escaping again. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Character references resolved.
 *
 * Text has to be decoded before it is escaped again, or `&amp;` in the input
 * would be published as `&amp;amp;`. A reference this module does not know is
 * left as the characters it is made of, which the escaping below then makes
 * safe.
 */
function decodeEntities(value: string): string {
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

/**
 * Text as markup: decoded, then escaped.
 *
 * Every one of the five characters is escaped, so the same function serves an
 * attribute value as well as a text node, and the result is well formed XML as
 * well as HTML. The apostrophe is written numerically because `&apos;` is not
 * one of HTML 4's named references.
 */
function escapeText(value: string): string {
  return decodeEntities(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
