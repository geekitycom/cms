/**
 * The XML a feed is written with: escaping, CDATA, indented elements, links
 * and authors, and the namespaces the vocabularies live in.
 *
 * Nothing here knows what a feed is. It is the plumbing the RSS and Atom
 * serialisers share, kept apart from them so that a question about escaping is
 * answered in one file rather than three, and so the serialisers read as the
 * shape of a document rather than as string handling.
 */

/**
 * Dave Winer's `source` namespace, which RSS 2.0 feeds here declare so an item
 * can carry the Markdown it was written from. TASK-38's `source:cloud` is the
 * same namespace.
 */
export const SOURCE_NAMESPACE = 'https://source.scripting.com/';

/** Dublin Core, which is where an RSS item's `creator` comes from. */
export const DC_NAMESPACE = 'http://purl.org/dc/elements/1.1/';

/**
 * The Well-Formed Web comment API, whose `commentRss` is how an RSS reader is
 * told where one item's comments are. WordPress puts it on every item, so a
 * reader that already understands a WordPress feed understands this one.
 */
export const WFW_NAMESPACE = 'http://wellformedweb.org/CommentAPI/';

/**
 * A date as RFC 822, which is what RSS 2.0's `pubDate` and `lastBuildDate`
 * are. `toUTCString` writes exactly that spelling, `GMT` zone included.
 */
export function rfc822(date: Date): string {
  return date.toUTCString();
}

/**
 * XML character data, escaped.
 *
 * `<` and `&` have to go; `>` follows them because `]]>` in text is not
 * allowed and spotting it is not worth the trouble. Quotes are escaped too so
 * one function serves attribute values as well as text. Characters XML 1.0
 * cannot represent at all — the C0 controls other than tab, newline and
 * carriage return — are dropped rather than escaped, because there is no
 * spelling of them that would parse.
 */
export function escapeXml(value: string): string {
  let out = '';
  for (const character of value) {
    switch (character) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case "'":
        out += '&apos;';
        break;
      default:
        if (isValidXmlChar(character)) out += character;
    }
  }
  return out;
}

/**
 * Character data as a CDATA section, which is how a feed carries markup a
 * reader is meant to render rather than display.
 *
 * The only sequence a section may not contain is its own terminator, so a
 * `]]>` in the text is split across two sections; the parser rejoins them and
 * the reader sees the original bytes. Characters XML 1.0 cannot represent are
 * dropped, exactly as {@link escapeXml} drops them, because CDATA suspends
 * escaping and not the character set.
 */
export function cdata(value: string): string {
  let text = '';
  for (const character of value) {
    if (isValidXmlChar(character)) text += character;
  }
  return `<![CDATA[${text.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

/** Whether a character is one XML 1.0 allows in a document at all. */
function isValidXmlChar(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  if (code === 0x9 || code === 0xa || code === 0xd) return true;
  if (code >= 0x20 && code <= 0xd7ff) return true;
  if (code >= 0xe000 && code <= 0xfffd) return true;
  return code >= 0x10000 && code <= 0x10ffff;
}

/** An element holding text, indented. */
export function element(name: string, text: string, depth = 1): string {
  return `${'  '.repeat(depth)}<${name}>${escapeXml(text)}</${name}>`;
}

/** The same, or nothing at all when there is no value. */
export function optionalElement(name: string, text: string | undefined, depth = 1): string[] {
  return text === undefined ? [] : [element(name, text, depth)];
}

/** An Atom `<link>`. The `type` is left off when there is nothing to declare. */
export function link(attributes: { rel: string; type?: string; href: string }, depth = 1): string {
  const type = attributes.type === undefined ? '' : ` type="${escapeXml(attributes.type)}"`;
  return `${'  '.repeat(depth)}<link rel="${escapeXml(
    attributes.rel,
  )}"${type} href="${escapeXml(attributes.href)}"/>`;
}

/** An Atom `<author>`, or nothing when nobody is named. */
export function author(name: string | undefined, depth: number): string[] {
  if (name === undefined) return [];
  const indent = '  '.repeat(depth);
  return [`${indent}<author>`, element('name', name, depth + 1), `${indent}</author>`];
}
