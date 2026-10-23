import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';

import { renderDocument, type Options } from './render.ts';
import { nest } from './tree.ts';

/**
 * Where a link's `=>` line goes, since gemtext has no inline links.
 *
 * - `paragraph`: the text is marked `[1]` and the line follows its block.
 * - `at-end`: the text is marked `[1]` and the line goes at the end.
 * - `copy`: the text stays as it is and the line, labelled with it, follows its block.
 * - `newline`: the line replaces the link, breaking the text around it.
 * - `off`: only the text is kept.
 */
export type LinkMode = 'paragraph' | 'at-end' | 'copy' | 'newline' | 'off';

export interface ConvertOptions {
  /** Defaults to `paragraph`. */
  readonly links?: LinkMode;
  /** Remove emphasis, strong, strikethrough and inline code markup, and inline HTML. */
  readonly plain?: boolean;
  /** Remove inline and block HTML. */
  readonly stripHtml?: boolean;
  /** Remove YAML (`---`) or TOML (`+++`) front matter before converting. */
  readonly stripFrontMatter?: boolean;
  /** Applied to the URL of every link and image, such as to point `.md` links at `.gmi`. */
  readonly rewriteLink?: (url: string) => string;
  /** Written after an image's alt text on its `=>` line. Defaults to `[IMG]`; empty leaves it out. */
  readonly imageTag?: string;
  /** Alt text of a code block that names no language. Defaults to empty. */
  readonly codeTag?: string;
  /** Alt text of a table's preformatted block. Defaults to `table`. */
  readonly tableTag?: string;
  /** Written once per level before a nested list item. Defaults to two spaces. */
  readonly indent?: string;
  /** Draw GFM `[ ]` and `[x]` items as ☐ and ☑. Defaults to true. */
  readonly checklist?: boolean;
}

const DEFAULTS: Options = {
  links: 'paragraph',
  plain: false,
  stripHtml: false,
  stripFrontMatter: false,
  rewriteLink: (url) => url,
  imageTag: '[IMG]',
  codeTag: '',
  tableTag: 'table',
  indent: '  ',
  checklist: true,
};

const FRONT_MATTER = /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1[ \t]*(?:\r?\n|$)/;

const parser = new MarkdownIt({ html: true, linkify: true }).use(footnote);

/** Converts a Markdown document to gemtext. */
export function convert(markdown: string, options: ConvertOptions = {}): string {
  const resolved: Options = { ...DEFAULTS, ...options };
  const source = resolved.stripFrontMatter ? markdown.replace(FRONT_MATTER, '') : markdown;
  return renderDocument(nest(parser.parse(source, {})), resolved);
}
