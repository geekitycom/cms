import sax from 'sax';

export interface WordPressExport {
  readonly site: WordPressSite;
  readonly authors: readonly WordPressAuthor[];
  /** Every item, in the export's order: posts, pages, attachments and whatever else the site stored as a post. */
  readonly items: readonly WordPressItem[];
}

export interface WordPressSite {
  readonly title: string;
  readonly link: string;
  readonly language: string;
  readonly baseSiteUrl: string;
  readonly baseBlogUrl: string;
}

export interface WordPressAuthor {
  readonly id: number;
  readonly login: string;
  readonly email: string;
  readonly displayName: string;
}

export interface WordPressTerm {
  /** `category`, `post_tag`, `post_format` or a custom taxonomy. */
  readonly taxonomy: string;
  readonly slug: string;
  readonly name: string;
}

/** One meta row. A key may repeat, as `_wp_old_slug` does. */
export interface WordPressMeta {
  readonly key: string;
  readonly value: string;
}

export interface WordPressItem {
  readonly id: number;
  readonly type: string;
  readonly status: string;
  readonly title: string;
  readonly link: string;
  readonly guid: string;
  /** `post_name`. */
  readonly slug: string;
  /** The author's login. */
  readonly creator: string;
  readonly content: string;
  readonly excerpt: string;
  /** `post_date` in the site's time zone, as WordPress wrote it. */
  readonly date: string;
  /** `post_date_gmt` as an ISO instant, or `undefined` for a draft that has none. */
  readonly dateGmt: string | undefined;
  readonly modifiedGmt: string | undefined;
  readonly parent: number;
  readonly menuOrder: number;
  readonly password: string;
  readonly sticky: boolean;
  readonly attachmentUrl: string | undefined;
  readonly terms: readonly WordPressTerm[];
  readonly meta: readonly WordPressMeta[];
  readonly comments: readonly WordPressComment[];
}

export interface WordPressComment {
  readonly id: number;
  readonly parent: number;
  /** `comment`, `pingback`, `like` and so on; WordPress writes an empty type for a plain comment. */
  readonly type: string;
  /** `1`, `0`, `spam` or `trash`. */
  readonly approved: string;
  readonly author: string;
  readonly authorEmail: string;
  readonly authorUrl: string;
  readonly authorIp: string;
  readonly date: string;
  readonly dateGmt: string | undefined;
  readonly content: string;
  readonly userId: number;
  readonly meta: readonly WordPressMeta[];
}

export class NotAWordPressExportError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.join('\n'));
    this.name = 'NotAWordPressExportError';
  }
}

interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  text: string;
}

export function parseWordPressExport(xml: string): WordPressExport {
  const root = parseXml(xml);
  if (root.name !== 'rss') {
    throw new NotAWordPressExportError([
      `The document is <${root.name}>, and a WordPress export is <rss>.`,
    ]);
  }
  const channel = child(root, 'channel');
  if (channel === undefined) {
    throw new NotAWordPressExportError(['The <rss> holds no <channel>.']);
  }
  if (child(channel, 'wp:wxr_version') === undefined) {
    throw new NotAWordPressExportError([
      'The <channel> has no <wp:wxr_version>, which every WordPress export carries: this is an RSS feed, not an export.',
    ]);
  }

  const problems: string[] = [];
  const items = children(channel, 'item').flatMap((element, index) => {
    const read = new FieldReader(element, `item ${String(index + 1)}`, problems);
    const item = readItem(read);
    return read.failed ? [] : [item];
  });
  const authors = children(channel, 'wp:author').map((element, index) =>
    readAuthor(new FieldReader(element, `author ${String(index + 1)}`, problems)),
  );
  if (problems.length > 0) throw new NotAWordPressExportError(problems);

  return {
    site: {
      title: text(channel, 'title'),
      link: text(channel, 'link'),
      language: text(channel, 'language'),
      baseSiteUrl: text(channel, 'wp:base_site_url'),
      baseBlogUrl: text(channel, 'wp:base_blog_url'),
    },
    authors,
    items,
  };
}

function readAuthor(read: FieldReader): WordPressAuthor {
  return {
    id: read.integer('wp:author_id'),
    login: read.text('wp:author_login'),
    email: read.text('wp:author_email'),
    displayName: read.text('wp:author_display_name'),
  };
}

function readItem(read: FieldReader): WordPressItem {
  return {
    id: read.integer('wp:post_id'),
    type: read.required('wp:post_type'),
    status: read.text('wp:status'),
    title: read.text('title'),
    link: read.text('link'),
    guid: read.text('guid'),
    slug: read.text('wp:post_name'),
    creator: read.text('dc:creator'),
    content: read.text('content:encoded'),
    excerpt: read.text('excerpt:encoded'),
    date: read.text('wp:post_date'),
    dateGmt: read.instant('wp:post_date_gmt'),
    modifiedGmt: read.instant('wp:post_modified_gmt'),
    parent: read.integer('wp:post_parent', 0),
    menuOrder: read.integer('wp:menu_order', 0),
    password: read.text('wp:post_password'),
    sticky: read.text('wp:is_sticky') === '1',
    attachmentUrl: read.optional('wp:attachment_url'),
    terms: children(read.element, 'category').map((element) => ({
      taxonomy: element.attributes['domain'] ?? '',
      slug: element.attributes['nicename'] ?? '',
      name: element.text,
    })),
    meta: readMeta(read.element, 'wp:postmeta'),
    comments: children(read.element, 'wp:comment').map((element) => {
      const comment = new FieldReader(element, `${read.label} comment`, read.problems);
      return {
        id: comment.integer('wp:comment_id'),
        parent: comment.integer('wp:comment_parent', 0),
        type: comment.text('wp:comment_type'),
        approved: comment.text('wp:comment_approved'),
        author: comment.text('wp:comment_author'),
        authorEmail: comment.text('wp:comment_author_email'),
        authorUrl: comment.text('wp:comment_author_url'),
        authorIp: comment.text('wp:comment_author_IP'),
        date: comment.text('wp:comment_date'),
        dateGmt: comment.instant('wp:comment_date_gmt'),
        content: comment.text('wp:comment_content'),
        userId: comment.integer('wp:comment_user_id', 0),
        meta: readMeta(element, 'wp:commentmeta'),
      };
    }),
  };
}

function readMeta(element: XmlElement, name: string): WordPressMeta[] {
  return children(element, name).map((row) => ({
    key: text(row, 'wp:meta_key'),
    value: text(row, 'wp:meta_value'),
  }));
}

class FieldReader {
  failed = false;

  constructor(
    readonly element: XmlElement,
    readonly label: string,
    readonly problems: string[],
  ) {
    const title = child(element, 'title')?.text;
    if (title !== undefined && title !== '') this.label = `${label} ("${title}")`;
  }

  text(name: string): string {
    return child(this.element, name)?.text.trim() ?? '';
  }

  optional(name: string): string | undefined {
    return child(this.element, name)?.text.trim();
  }

  required(name: string): string {
    const value = this.text(name);
    if (value === '') this.fail(`has no <${name}>`);
    return value;
  }

  integer(name: string, fallback?: number): number {
    const value = this.optional(name);
    if (value === undefined || value === '') {
      if (fallback !== undefined) return fallback;
      this.fail(`has no <${name}>`);
      return 0;
    }
    if (!/^[0-9]+$/.test(value)) this.fail(`has <${name}> "${value}", which is not a whole number`);
    return Number(value);
  }

  /** A `YYYY-MM-DD HH:MM:SS` UTC time as an ISO instant; WordPress's zero date is none. */
  instant(name: string): string | undefined {
    const value = this.text(name);
    if (value === '' || value.startsWith('0000-00-00')) return undefined;
    const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
    if (match === null) {
      this.fail(`has <${name}> "${value}", which is not a YYYY-MM-DD HH:MM:SS time`);
      return undefined;
    }
    return `${match[1] ?? ''}T${match[2] ?? ''}Z`;
  }

  private fail(problem: string): void {
    this.failed = true;
    this.problems.push(`${this.label} ${problem}.`);
  }
}

function child(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((entry) => entry.name === name);
}

function children(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((entry) => entry.name === name);
}

function text(element: XmlElement, name: string): string {
  return child(element, name)?.text.trim() ?? '';
}

function parseXml(xml: string): XmlElement {
  const parser = sax.parser(true, { trim: false, normalize: false });
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let failure: string | undefined;

  parser.onopentag = (tag) => {
    const element: XmlElement = {
      name: tag.name,
      attributes: Object.fromEntries(
        Object.entries(tag.attributes).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
      children: [],
      text: '',
    };
    stack.at(-1)?.children.push(element);
    root ??= element;
    stack.push(element);
  };
  parser.onclosetag = () => {
    stack.pop();
  };
  const append = (chunk: string): void => {
    const open = stack.at(-1);
    if (open !== undefined) open.text += chunk;
  };
  parser.ontext = append;
  parser.oncdata = append;
  parser.onerror = (error) => {
    throw error;
  };

  try {
    parser.write(xml).close();
  } catch (error) {
    failure = error instanceof Error ? error.message.split('\n')[0] : String(error);
  }
  if (failure !== undefined || root === undefined) {
    throw new NotAWordPressExportError([
      `The file is not well-formed XML: ${failure ?? 'it holds no element'} at line ${String(parser.line + 1)}, column ${String(parser.column + 1)}.`,
    ]);
  }
  return root;
}
