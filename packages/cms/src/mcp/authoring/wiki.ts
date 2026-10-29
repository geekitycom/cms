import { userForAuthor } from '../../content/authors.ts';
import { DOCUMENT_DIRECTORIES } from '../../content/content-tree.ts';
import type { Document } from '../../content/document.ts';
import { blankForm, formFor } from '../../content/document-form.ts';
import { WIKI_KIND } from '../../content/document-kind.ts';
import { permalinkOfObjectId } from '../../content/permalinks.ts';
import { writeDocument } from '../../content/write.ts';
import { listUsers } from '../../site/users.ts';
import type { User } from '../../site/users.ts';
import { absoluteUrl } from '../../util/url.ts';
import { documentSiteFrom } from '../../web/document-site.ts';
import { READ_ONLY } from '../inspect/schemas.ts';
import { defineTool, isRefused, refused } from '../tools.ts';
import type { Refused, ToolSite } from '../tools.ts';
import { unsaved } from './shared.ts';

const PAGE_INPUT = {
  type: 'string',
  description: 'The wiki page: its slug or its address.',
} as const;

const WIKI_WRITTEN = {
  url: { type: 'string', description: 'The wiki page’s address.' },
  slug: { type: 'string' },
  draft: { type: 'boolean' },
} as const;

function findWikiPage(site: ToolSite, reference: string): Document | Refused {
  const url = URL.parse(reference);
  const permalink =
    url === null
      ? undefined
      : permalinkOfObjectId(`${url.origin}${url.pathname}`, site.config.baseUrl);
  const found =
    url === null
      ? site.store.getByPath(`${DOCUMENT_DIRECTORIES.wiki}/${reference}.md`)
      : permalink === undefined
        ? undefined
        : site.store.getByPermalink(permalink);
  return found?.type === 'wiki' ? found : refused(`No wiki page answers to ${reference}.`);
}

function ownWikiPage(site: ToolSite, user: User, reference: string): Document | Refused {
  const document = findWikiPage(site, reference);
  if (isRefused(document)) return document;
  const author = userForAuthor(listUsers(site.config.dataDir), document.author);
  if (author !== undefined && author.id !== user.id) {
    return refused(`${reference} is not your wiki page.`);
  }
  return document;
}

export const createWikiPage = defineTool({
  name: 'create_wiki_page',
  title: 'Write a wiki page',
  description:
    'Write a new wiki page under wiki/, at the wiki base and its slug, as the admin’s Wiki editor does. A draft unless draft is false, which needs the publish scope. Link to other wiki pages with [[Title]] in the body.',
  scope: 'create',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'The page’s title.' },
      body: { type: 'string', description: 'The page in Markdown.' },
      slug: {
        type: 'string',
        description: 'The file name and the end of the URL. Made from the title unless given.',
      },
      draft: { type: 'boolean', description: 'true unless given.' },
    },
    required: ['title', 'body'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: WIKI_WRITTEN,
    required: ['url', 'slug', 'draft'],
  },
  run: async (args, { user, token, site }) => {
    const draft = args.draft ?? true;
    if (!draft && !token.scopes.includes('publish')) return { needsScope: 'publish' };

    const { store, config } = site;
    const form = {
      ...blankForm(WIKI_KIND, site.siteAtRequestStart.timezone, store.now()),
      title: args.title.trim(),
      slug: args.slug?.trim() ?? '',
      body: args.body,
    };
    const written = await writeDocument(documentSiteFrom(site, user.username), {
      kind: WIKI_KIND,
      document: undefined,
      form,
      draft,
    });
    if (written.outcome === 'refused') return refused(written.message);
    if (written.outcome === 'conflict') {
      throw new Error('A new wiki page has no file to conflict with.');
    }
    const { saved } = written;
    const url = absoluteUrl(saved.permalink, config.baseUrl);
    return {
      ok: true,
      summary: `${saved.draft ? 'Drafted' : 'Published'} ${saved.slug} at ${url}.`,
      structured: { url, slug: saved.slug, draft: saved.draft },
    };
  },
});

export const getWikiPage = defineTool({
  name: 'get_wiki_page',
  title: 'Read a wiki page',
  description:
    'One of your wiki pages as it is written: its title, its Markdown body and whether it is a draft. Returns the hash update_wiki_page needs, so an edit fails rather than overwrites when the page changed in between.',
  scope: 'update',
  annotations: READ_ONLY,
  inputSchema: {
    type: 'object',
    properties: { page: PAGE_INPUT },
    required: ['page'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      slug: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string', description: 'The page in Markdown.' },
      draft: { type: 'boolean' },
      hash: { type: 'string', description: 'The version read. Pass it to update_wiki_page.' },
    },
    required: ['url', 'slug', 'title', 'body', 'draft', 'hash'],
  },
  run: (args, { user, site }) => {
    const document = ownWikiPage(site, user, args.page);
    if (isRefused(document)) return Promise.resolve(document);
    const url = absoluteUrl(document.permalink, site.config.baseUrl);
    return Promise.resolve({
      ok: true,
      summary: `${document.slug} is ${document.draft ? 'a draft' : 'published'} at ${url}.`,
      structured: {
        url,
        slug: document.slug,
        title: document.title,
        body: document.body,
        draft: document.draft,
        hash: document.hash,
      },
    });
  },
});

export const updateWikiPage = defineTool({
  name: 'update_wiki_page',
  title: 'Edit a wiki page',
  description:
    'Change the title, the body or the draft state of one of your wiki pages, leaving what is not given as it is. Read the page with get_wiki_page first and pass its hash: when the page changed since, nothing is written. Changing a published page, or setting draft to false, needs the publish scope as well.',
  scope: 'update',
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      page: PAGE_INPUT,
      hash: { type: 'string', description: 'The hash get_wiki_page returned.' },
      title: { type: 'string' },
      body: { type: 'string', description: 'The whole page in Markdown.' },
      draft: { type: 'boolean' },
    },
    required: ['page', 'hash'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: WIKI_WRITTEN,
    required: ['url', 'slug', 'draft'],
  },
  run: async (args, { user, token, site }) => {
    const document = ownWikiPage(site, user, args.page);
    if (isRefused(document)) return document;
    if (args.title === undefined && args.body === undefined && args.draft === undefined) {
      return refused('Give a title, a body or a draft state to change.');
    }
    const draft = args.draft ?? document.draft;
    if ((!document.draft || !draft) && !token.scopes.includes('publish')) {
      return { needsScope: 'publish' };
    }

    const form = formFor(WIKI_KIND, document, site.siteAtRequestStart.timezone, undefined);
    const written = await writeDocument(documentSiteFrom(site, user.username), {
      kind: WIKI_KIND,
      document,
      form: {
        ...form,
        title: args.title?.trim() ?? form.title,
        body: args.body ?? form.body,
        hash: args.hash,
      },
      draft,
    });
    if (written.outcome !== 'saved') return unsaved(written, document.slug, 'get_wiki_page');
    const { saved } = written;
    const url = absoluteUrl(saved.permalink, site.config.baseUrl);
    return {
      ok: true,
      summary: `Updated ${saved.slug} at ${url}${saved.draft ? ', still a draft' : ''}.`,
      structured: { url, slug: saved.slug, draft: saved.draft },
    };
  },
});
