import type { Document } from './document.ts';

/**
 * What the full-text index is fed and how a reader's words become a query
 * against it (TASK-22).
 *
 * The index itself is an FTS5 table in the content store, written and dropped
 * alongside the document rows, so it is derived exactly as they are
 * (decision-9). This module is the part that needs no database: the text a
 * document is indexed by, and the translation from what somebody typed into a
 * search box into an FTS5 `MATCH` expression that cannot be a syntax error.
 */

/**
 * The marks the index puts either side of a matched word in a snippet.
 *
 * Control characters rather than markup, because the snippet is plain text
 * that the web layer escapes before it turns these into `<mark>`: a post that
 * talks about `<mark>` should print the words, not the element. They are
 * stripped out of everything indexed, so a document cannot forge one.
 */
export const SNIPPET_OPEN = '\u0002';
export const SNIPPET_CLOSE = '\u0003';

/** How many terms of a query are kept. Anything longer is somebody pasting a post. */
export const MAXIMUM_QUERY_TERMS = 16;

/** The columns of the index, in the order the table declares them. */
export interface SearchText {
  /** The document's title. */
  title: string;
  /** Its description, or an empty string. */
  description: string;
  /** Its tags and categories, space-separated. */
  terms: string;
  /** Its rendered body as plain text. */
  body: string;
}

/**
 * What one document is indexed by.
 *
 * The body is the rendered HTML stripped to text rather than the Markdown, so
 * a link's URL, a fence's language and the syntax around emphasis are not
 * words a reader can find a post by — only what the post says.
 */
export function searchText(document: Document): SearchText {
  return {
    title: clean(document.title),
    description: clean(document.description ?? ''),
    terms: clean([...document.tags, ...document.categories].join(' ')),
    body: htmlToText(document.html),
  };
}

/**
 * Some HTML as the words a reader sees.
 *
 * A block tag becomes a space, so `</p><p>` between two paragraphs does not
 * glue the last word of one to the first word of the next; an inline tag
 * becomes nothing, so `<a>there</a>.` reads "there." rather than "there ."
 * in a snippet. Scripts and styles go entirely, contents and all.
 */
export function htmlToText(html: string): string {
  return clean(
    decodeEntities(
      html
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(BLOCK_TAG, ' ')
        .replace(/<[^>]*>/g, ''),
    ),
  );
}

/** Tags that separate words: blocks, line breaks and the things between cells. */
const BLOCK_TAG =
  /<\/?(?:address|article|aside|blockquote|br|dd|details|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|img|li|nav|ol|p|pre|section|summary|table|td|th|tr|ul)\b[^>]*>/gi;

/**
 * A reader's query as an FTS5 `MATCH` expression, or `undefined` when there is
 * nothing in it to search for.
 *
 * Every term is quoted, so nothing a reader types — a stray `"`, a `-`, an
 * `AND`, a `column:` prefix, a bracket — is ever read as FTS5 syntax: the
 * worst a query can do is find nothing. What it does understand is the two
 * things a search box is expected to: words in `"double quotes"` are a phrase,
 * and a bare word ending in `*` is a prefix. Terms are joined by FTS5's
 * implicit AND, so every word has to be somewhere in the document.
 */
export function searchExpression(query: string): string | undefined {
  const terms: string[] = [];
  // A quoted phrase, a quote left open at the end, or a run of anything else.
  const pattern = /"([^"]*)"?|([^\s"]+)/g;

  for (const match of clean(query).matchAll(pattern)) {
    if (terms.length >= MAXIMUM_QUERY_TERMS) break;

    const phrase = match[1];
    if (phrase !== undefined) {
      if (isSearchable(phrase)) terms.push(quote(phrase.trim()));
      continue;
    }

    const word = match[2] as string;
    const prefix = word.length > 1 && word.endsWith('*');
    const stem = word.replace(/\*+$/, '');
    if (!isSearchable(stem)) continue;
    terms.push(prefix ? `${quote(stem)} *` : quote(stem));
  }

  return terms.length === 0 ? undefined : terms.join(' ');
}

/**
 * Whether a term holds anything the tokenizer would keep. A term of nothing
 * but punctuation becomes an empty phrase, which matches nothing and would
 * turn a query of three good words and a dash into a query that finds nothing.
 */
function isSearchable(term: string): boolean {
  return /[\p{L}\p{N}]/u.test(term);
}

/** A term as an FTS5 string, which escapes a quote by doubling it. */
function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/** Whitespace collapsed, and the snippet marks taken out so nothing can forge one. */
function clean(value: string): string {
  return value
    .replaceAll(SNIPPET_OPEN, '')
    .replaceAll(SNIPPET_CLOSE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The entities a rendered body holds, named or numeric, resolved to text. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/** The named entities Markdown output and hand-written HTML actually use. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};
