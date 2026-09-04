import assert from 'node:assert/strict';

/**
 * A strict XML reader, so "well formed" is proved rather than assumed.
 *
 * The tests own this rather than the CMS, so every XML body the site writes —
 * the feeds, the sitemap — is checked against an independent reading of the
 * bytes instead of against the code that wrote them. It lives here rather than
 * in one test file because more than one kind of document needs it.
 */

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Character data directly inside this element, entities resolved. */
  text: string;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Parse an XML document, refusing anything that is not well formed: mismatched
 * or unclosed tags, unquoted attributes, a bare `<` or `&` in character data,
 * an unknown entity, or content after the root element.
 *
 * The test owns this rather than the CMS, so the feed is checked against an
 * independent reading of the bytes instead of against the code that wrote them.
 */
export function parseXml(source: string): XmlElement {
  let at = 0;

  function fail(message: string): never {
    throw new Error(
      `${message} at offset ${String(at)}: ${JSON.stringify(source.slice(at, at + 40))}`,
    );
  }

  function skipMisc(): void {
    for (;;) {
      while (at < source.length && /\s/.test(source[at] ?? '')) at += 1;
      if (source.startsWith('<?', at)) {
        const end = source.indexOf('?>', at);
        if (end < 0) fail('unterminated processing instruction');
        at = end + 2;
        continue;
      }
      if (source.startsWith('<!--', at)) {
        const end = source.indexOf('-->', at);
        if (end < 0) fail('unterminated comment');
        at = end + 3;
        continue;
      }
      return;
    }
  }

  function readName(): string {
    const match = /^[A-Za-z_:][\w.:-]*/.exec(source.slice(at));
    if (match === null) fail('expected a name');
    at += match[0].length;
    return match[0];
  }

  /** Resolve the entity references in character data, rejecting bad ones. */
  function decode(raw: string, where: string): string {
    let out = '';
    let index = 0;
    while (index < raw.length) {
      const character = raw[index] ?? '';
      if (character !== '&') {
        if (character === '<') fail(`a bare "<" in ${where}`);
        out += character;
        index += 1;
        continue;
      }
      const semicolon = raw.indexOf(';', index);
      if (semicolon < 0) fail(`an unterminated entity reference in ${where}`);
      const reference = raw.slice(index + 1, semicolon);
      if (reference.startsWith('#x')) {
        out += String.fromCodePoint(Number.parseInt(reference.slice(2), 16));
      } else if (reference.startsWith('#')) {
        out += String.fromCodePoint(Number.parseInt(reference.slice(1), 10));
      } else {
        const value = ENTITIES[reference];
        if (value === undefined) fail(`the unknown entity "&${reference};" in ${where}`);
        out += value;
      }
      index = semicolon + 1;
    }
    return out;
  }

  function readAttributes(): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (;;) {
      while (at < source.length && /\s/.test(source[at] ?? '')) at += 1;
      if (source.startsWith('>', at) || source.startsWith('/>', at)) return attributes;

      const name = readName();
      if (source[at] !== '=') fail(`no value for the attribute "${name}"`);
      at += 1;
      const quote = source[at];
      if (quote !== '"' && quote !== "'") fail(`an unquoted value for the attribute "${name}"`);
      at += 1;
      const end = source.indexOf(quote, at);
      if (end < 0) fail(`an unterminated value for the attribute "${name}"`);
      if (name in attributes) fail(`the attribute "${name}" twice on one element`);
      attributes[name] = decode(source.slice(at, end), `the attribute "${name}"`);
      at = end + 1;
    }
  }

  function readElement(): XmlElement {
    if (source[at] !== '<') fail('expected an element');
    at += 1;
    const name = readName();
    const attributes = readAttributes();

    if (source.startsWith('/>', at)) {
      at += 2;
      return { name, attributes, children: [], text: '' };
    }
    if (source[at] !== '>') fail(`an unterminated start tag for "${name}"`);
    at += 1;

    const element: XmlElement = { name, attributes, children: [], text: '' };

    for (;;) {
      if (at >= source.length) fail(`no closing tag for "${name}"`);

      if (source.startsWith('</', at)) {
        at += 2;
        const closing = readName();
        if (closing !== name) fail(`"</${closing}>" closing "<${name}>"`);
        while (at < source.length && /\s/.test(source[at] ?? '')) at += 1;
        if (source[at] !== '>') fail(`an unterminated end tag for "${name}"`);
        at += 1;
        return element;
      }

      if (source.startsWith('<!--', at)) {
        const end = source.indexOf('-->', at);
        if (end < 0) fail('unterminated comment');
        at = end + 3;
        continue;
      }

      // A CDATA section is character data taken literally: no entities are
      // resolved inside it, and it ends at the first `]]>`. A writer that
      // emitted a `]]>` of its own without splitting it would end the section
      // early and leave the rest as markup, which the rest of this reader
      // then rejects.
      if (source.startsWith('<![CDATA[', at)) {
        const end = source.indexOf(']]>', at);
        if (end < 0) fail('unterminated CDATA section');
        element.text += source.slice(at + '<![CDATA['.length, end);
        at = end + 3;
        continue;
      }

      if (source[at] === '<') {
        element.children.push(readElement());
        continue;
      }

      const next = source.indexOf('<', at);
      const raw = source.slice(at, next < 0 ? source.length : next);
      element.text += decode(raw, `the text of "${name}"`);
      at += raw.length;
    }
  }

  skipMisc();
  const root = readElement();
  skipMisc();
  if (at < source.length) fail('content after the root element');
  return root;
}

/** The one child element with this name, asserting there is exactly one. */
export function child(element: XmlElement, name: string): XmlElement {
  const found = element.children.filter((candidate) => candidate.name === name);
  assert.equal(found.length, 1, `exactly one <${name}> inside <${element.name}>`);
  return found[0] as XmlElement;
}

/** Every child element with this name, in document order. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((candidate) => candidate.name === name);
}
