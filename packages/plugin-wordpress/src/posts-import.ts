import { dump } from 'js-yaml';

import type { PluginCommandContext } from '@geekity/cms/plugin';

import type {
  DataEntry,
  ImportedFile,
  ImporterOutput,
  ItemNote,
  WordPressImporter,
} from './content-import.ts';
import { wordPressMedia } from './media.ts';
import { convertBody } from './wordpress-html.ts';
import type { WordPressExport, WordPressItem } from './wxr.ts';

type Disposition =
  | {
      readonly kind: 'import';
      readonly draft: boolean;
      readonly servedByWordPress: boolean;
      readonly migrated: boolean;
      readonly warning?: string;
    }
  | { readonly kind: 'skip'; readonly why: string };

function dispositionOf(item: WordPressItem): Disposition {
  switch (item.status) {
    case 'publish':
      return item.password === ''
        ? { kind: 'import', draft: false, servedByWordPress: true, migrated: true }
        : {
            kind: 'import',
            draft: true,
            servedByWordPress: true,
            migrated: true,
            warning:
              'password-protected on WordPress; imported as a draft, since this site has no post passwords',
          };
    case 'future':
      return { kind: 'import', draft: false, servedByWordPress: false, migrated: false };
    case 'draft':
    case 'pending':
      return { kind: 'import', draft: true, servedByWordPress: false, migrated: true };
    case 'private':
      return {
        kind: 'import',
        draft: true,
        servedByWordPress: false,
        migrated: true,
        warning: 'private on WordPress; imported as a draft, since this site has no private posts',
      };
    case 'trash':
      return { kind: 'skip', why: 'in the WordPress trash' };
    case 'auto-draft':
      return { kind: 'skip', why: 'an empty draft WordPress saved when the editor opened' };
    default:
      return {
        kind: 'skip',
        why: `WordPress status "${item.status}", which this import does not know`,
      };
  }
}

const SITE_JSON = '_data/site.json';

export const postsAndPages: WordPressImporter = {
  postTypes: ['post', 'page'],
  import: importPostsAndPages,
};

function importPostsAndPages(
  exported: WordPressExport,
  context: PluginCommandContext,
): ImporterOutput {
  const items = exported.items.filter((item) => item.type === 'post' || item.type === 'page');
  const home = homeOf(exported);
  const structure = inferredPermalinkStructure(items, home);
  const pagesById = new Map(
    items.filter((item) => item.type === 'page').map((item) => [item.id, item]),
  );
  const users = new Set(context.site.users().map((user) => user.username));
  const media = wordPressMedia(exported, context.options['origins']);

  const files: ImportedFile[] = [];
  const notes: ItemNote[] = [];
  const entries: DataEntry[] = [];
  const taken = new Set<string>();

  for (const item of items) {
    const disposition = dispositionOf(item);
    if (disposition.kind === 'skip') {
      notes.push({ item, outcome: 'skipped', why: disposition.why });
      continue;
    }
    if (disposition.warning !== undefined) {
      notes.push({ item, outcome: 'warned', why: disposition.warning });
    }

    const frontPage = item.type === 'page' && sameUrl(item.link, home.href);
    const permalink =
      item.type === 'page'
        ? frontPage || !isPretty(item.link, home)
          ? pagePermalink(item, pagesById)
          : decodedPath(item.link)
        : isPretty(item.link, home)
          ? decodedPath(item.link)
          : structure(item);

    const author = users.has(item.creator) ? item.creator : undefined;
    if (author === undefined) {
      notes.push({
        item,
        outcome: 'warned',
        why: `written by "${item.creator}", who has no user on this site; imported with no author`,
      });
    }

    const body = convertBody(item.content);
    const front = frontMatter(item, disposition, {
      permalink,
      author,
      inReplyTo: body.inReplyTo,
      home,
    });
    files.push({
      item,
      path: unique(taken, fileName(item), item),
      contents: document(front, media.rewrite(body.markdown)),
    });

    if (frontPage && !disposition.draft) {
      entries.push({ item, file: SITE_JSON, key: 'homepage', value: lastSegment(permalink) });
    }
  }
  return { files, notes, entries };
}

interface Home {
  readonly href: string;
  readonly pathname: string;
}

function homeOf(exported: WordPressExport): Home {
  const base = exported.site.baseBlogUrl || exported.site.link;
  const url = new URL(base.endsWith('/') ? base : `${base}/`);
  return { href: url.href, pathname: url.pathname };
}

function sameUrl(a: string, b: string): boolean {
  const slash = (url: string) => (url.endsWith('/') ? url : `${url}/`);
  return slash(a) === slash(b);
}

/** Whether WordPress gave the item a pretty URL rather than its `?p=` or `?page_id=` one. */
function isPretty(link: string, home: Home): boolean {
  if (!URL.canParse(link)) return false;
  const url = new URL(link);
  return url.search === '' && url.pathname !== home.pathname;
}

function decodedPath(link: string): string {
  return new URL(link).pathname.split('/').map(decoded).join('/');
}

function decoded(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

function slugOf(item: WordPressItem): string {
  const slug = decoded(item.slug).replaceAll('/', '-');
  if (slug !== '') return slug;
  const fromTitle = item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return fromTitle === '' ? String(item.id) : fromTitle;
}

function lastSegment(permalink: string): string {
  return (
    permalink
      .split('/')
      .filter((segment) => segment !== '')
      .at(-1) ?? ''
  );
}

function pagePermalink(item: WordPressItem, pages: ReadonlyMap<number, WordPressItem>): string {
  const slugs = [slugOf(item)];
  const seen = new Set([item.id]);
  for (
    let parent = pages.get(item.parent);
    parent !== undefined && !seen.has(parent.id);
    parent = pages.get(parent.parent)
  ) {
    seen.add(parent.id);
    slugs.unshift(slugOf(parent));
  }
  return `/${slugs.join('/')}/`;
}

interface LocalDate {
  readonly year: string;
  readonly month: string;
  readonly day: string;
}

function localDateOf(item: WordPressItem): LocalDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(item.date);
  if (match === null || match[1] === '0000') return undefined;
  return { year: match[1] ?? '', month: match[2] ?? '', day: match[3] ?? '' };
}

const TOKENS = ['%year%', '%monthnum%', '%day%', '%postname%'] as const;

function inferredPermalinkStructure(
  items: readonly WordPressItem[],
  home: Home,
): (item: WordPressItem) => string {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.type !== 'post' || !isPretty(item.link, home)) continue;
    const date = localDateOf(item);
    const values = [date?.year, date?.month, date?.day, slugOf(item)];
    const template = decodedPath(item.link)
      .split('/')
      .map((segment) => {
        const index = values.indexOf(segment);
        return index === -1 ? segment : TOKENS[index];
      })
      .join('/');
    if (template.includes('%postname%')) counts.set(template, (counts.get(template) ?? 0) + 1);
  }
  let structure = '/%year%/%monthnum%/%postname%/';
  let best = 0;
  for (const [template, count] of counts) {
    if (count > best) {
      structure = template;
      best = count;
    }
  }
  return (item) => {
    const date = localDateOf(item) ?? localDateOf({ ...item, date: item.dateGmt ?? '' });
    const values = [date?.year ?? '', date?.month ?? '', date?.day ?? '', slugOf(item)];
    return TOKENS.reduce(
      (path, token, index) => path.replaceAll(token, values[index] ?? ''),
      structure,
    );
  };
}

function fileName(item: WordPressItem): string {
  if (item.type === 'page') return `pages/${slugOf(item)}.md`;
  const date = localDateOf(item);
  const prefix = date === undefined ? '' : `${date.year}-${date.month}-${date.day}-`;
  return `posts/${prefix}${slugOf(item)}.md`;
}

function unique(taken: Set<string>, path: string, item: WordPressItem): string {
  const chosen = taken.has(path) ? path.replace(/\.md$/, `-${String(item.id)}.md`) : path;
  taken.add(chosen);
  return chosen;
}

function isAbsoluteUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === 'https:' || protocol === 'http:';
}

function frontMatter(
  item: WordPressItem,
  disposition: Extract<Disposition, { kind: 'import' }>,
  derived: {
    permalink: string;
    author: string | undefined;
    inReplyTo: string | undefined;
    home: Home;
  },
): Record<string, unknown> {
  const isPost = item.type === 'post';
  const isStatus = item.terms.some(
    (term) => term.taxonomy === 'post_format' && term.slug === 'post-format-status',
  );
  const title = isPost ? (isStatus ? '' : item.title) : item.title || slugOf(item);
  const date = isPost ? item.dateGmt : undefined;
  const terms = (taxonomy: string) =>
    item.terms.filter((term) => term.taxonomy === taxonomy).map((term) => term.name);
  const federated = item.meta.some(
    (meta) => meta.key === 'activitypub_status' && meta.value === 'federated',
  );
  const shortlink = `${derived.home.href}?p=${String(item.id)}`;
  const objectId = isPost && disposition.servedByWordPress ? shortlink : undefined;
  const guid =
    isPost && item.guid !== shortlink && isAbsoluteUrl(item.guid) ? item.guid : undefined;

  const front: Record<string, unknown> = {};
  if (title !== '') front['title'] = title;
  if (date !== undefined) front['date'] = date;
  if (date !== undefined && item.modifiedGmt !== undefined && item.modifiedGmt !== date) {
    front['updated'] = item.modifiedGmt;
  }
  front['permalink'] = derived.permalink;
  if (terms('post_tag').length > 0) front['tags'] = terms('post_tag');
  if (terms('category').length > 0) front['categories'] = terms('category');
  if (disposition.draft) front['draft'] = true;
  if (derived.author !== undefined) front['author'] = derived.author;
  if (derived.inReplyTo !== undefined) front['in-reply-to'] = derived.inReplyTo;
  if (objectId !== undefined) {
    front['activitypub'] =
      federated && date !== undefined ? { id: objectId, published: date } : { id: objectId };
  }
  if (guid !== undefined) front['guid'] = guid;
  if (disposition.migrated) front['migrated'] = true;
  return front;
}

function document(front: Record<string, unknown>, body: string): string {
  const yaml = dump(front, { lineWidth: -1, noRefs: true });
  return body === '' ? `---\n${yaml}---\n` : `---\n${yaml}---\n\n${body}\n`;
}
