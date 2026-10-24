import { citationsOf, citesAnImage, previewShown } from '../content/citation.ts';
import type { Citation, CitedPageReader } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { postLabel, replyTarget } from '../content/post-type.ts';
import { capsuleUrl } from '../gemini/capsule.ts';
import type { ImageLoading } from '../images/markup.ts';
import { authorContext } from '../site/authors.ts';
import type { User } from '../site/users.ts';
import { frontPageSlugs, siteLocale, siteTimezone } from '../theme/site-data.ts';
import { absoluteUrl } from '../util/url.ts';
import { citedPictureAlt } from '../webmention/cited-picture.ts';
import { readCitedStart } from '../webmention/cited-start.ts';
import type { ReplyContext } from '../webmention/reply-context.ts';
import { archiveMonths, archiveOpen } from './archive.ts';
import type { ArchiveMonth } from './archive.ts';
import { citedPhotoContext, citedPictureContext, documentContext } from './context.ts';
import type { DocumentContext, NeighbourContext } from './context.ts';
import { representationHref } from './negotiate.ts';
import type { RenderDeps } from './render.ts';
import { requestSite } from './render-scope.ts';

export interface CitedContext {
  replyContext?: Record<string, unknown>;
  citations: (Citation & { context?: Record<string, unknown> })[];
}

export interface PageContexts {
  citedBy(document: Document): CitedContext;
  entryContext(document: Document, people: readonly User[], loading: ImageLoading): DocumentContext;
  newestPostsContext(page: Document): Record<string, unknown>;
  archiveOf(document: Document): ArchiveMonth[] | undefined;
  archiveContext(document: Document): Record<string, unknown>;
  postsPageContext(): Record<string, unknown>;
  capsuleContext(url: string): { capsuleUrl?: string };
}

export function createPageContexts(deps: RenderDeps): PageContexts {
  const { config, siteData, options, pages, users, citedPage } = deps;

  function entryContext(
    document: Document,
    people: readonly User[],
    loading: ImageLoading,
  ): DocumentContext {
    const context = documentContext(
      document,
      config,
      authorContext(people, document.author),
      loading,
      citedPage,
    );
    return { ...context, ...citedContext(deps, document) };
  }

  function newestPostsContext(page: Document): Record<string, unknown> {
    const source = options.newestPosts;
    if (source === undefined) return {};

    const pageLeads = page.html.includes('<img');
    return {
      newestPosts: (count: unknown) => {
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
          throw new RangeError(
            `newestPosts(count) takes a whole number of posts, at least 1, not ${String(count)}`,
          );
        }
        const people = users();
        return source(count).map((document, index) =>
          entryContext(document, people, { lead: !pageLeads && index === 0 }),
        );
      },
    };
  }

  function archiveOf(document: Document): ArchiveMonth[] | undefined {
    if (!archiveOpen(document)) return undefined;
    const posts = options.archivePosts?.();
    if (posts === undefined) return undefined;

    const site = siteData.read();
    return archiveMonths(posts, siteTimezone(site), siteLocale(site), citedPage);
  }

  function archiveContext(document: Document): Record<string, unknown> {
    const months = archiveOf(document);
    return months === undefined ? {} : { archiveMonths: months };
  }

  function postsPageContext(): Record<string, unknown> {
    const slug = frontPageSlugs(siteData.read()).postsPage;
    if (slug === '') return {};

    const found = pages().find((document) => document.slug === slug);
    return found === undefined
      ? {}
      : { postsPage: { title: postLabel(found), url: found.permalink } };
  }

  function capsuleContext(url: string): { capsuleUrl?: string } {
    const { pathname, search } = new URL(absoluteUrl(url, config.baseUrl));
    const capsule = capsuleUrl(
      config,
      requestSite(),
      representationHref(`${pathname}${search}`, 'gemini'),
    );
    return capsule === undefined ? {} : { capsuleUrl: capsule };
  }

  return {
    citedBy: (document) => citedContext(deps, document),
    entryContext,
    newestPostsContext,
    archiveOf,
    archiveContext,
    postsPageContext,
    capsuleContext,
  };
}

function citedContext(
  { config, citedPage }: Pick<RenderDeps, 'config' | 'citedPage'>,
  document: Document,
): CitedContext {
  const shown = previewShown(document.extra);
  const contextOf = (target: string, property: string): Record<string, unknown> | undefined => {
    const cited = citedPage?.(target);
    if (cited === undefined) return undefined;
    const { picture, author, ...rest } = cited;
    const image = citesAnImage(cited);
    const alt = citedPictureAlt(property, cited, document);
    const { photo, ...named } = author ?? { name: '' };
    return {
      ...replyContextFor(rest),
      ...(author === undefined
        ? {}
        : {
            author: {
              ...named,
              ...(photo === undefined || !shown ? {} : { photo: citedPhotoContext(photo, config) }),
            },
          }),
      ...(image ? { image } : {}),
      ...(picture === undefined || !shown
        ? {}
        : { picture: citedPictureContext(picture, property, alt, config) }),
    };
  };
  const target = replyTarget(document);
  const replyContext = target === undefined ? undefined : contextOf(target, 'in-reply-to');
  return {
    ...(replyContext === undefined ? {} : { replyContext }),
    citations: citationsOf(document.extra).map((citation) => {
      const context = contextOf(citation.url, citation.property);
      return context === undefined ? citation : { ...citation, context };
    }),
  };
}

export function neighbourContext(
  key: 'previous' | 'next',
  document: Document | undefined,
  cited: CitedPageReader | undefined,
): Record<string, NeighbourContext> | object {
  if (document === undefined) return {};
  return { [key]: { title: postLabel(document, cited), url: document.permalink } };
}

export function replyContextFor(context: Omit<ReplyContext, 'picture'>): Record<string, unknown> {
  const published = context.published === undefined ? undefined : new Date(context.published);
  const { published: _published, ...rest } = context;
  const dated =
    published === undefined || Number.isNaN(published.getTime()) ? rest : { ...rest, published };
  return { ...dated, ...eventStartFor(context.start) };
}

function eventStartFor(written: string | undefined): Record<string, unknown> {
  const start = readCitedStart(written ?? '');
  if (start === undefined) return {};
  return start.kind === 'wall-clock'
    ? { startDate: start.asUtc, startZone: 'UTC' }
    : { startDate: start.at };
}
