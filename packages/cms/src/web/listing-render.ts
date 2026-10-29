import { commentAnchor } from '../comments/conversation.ts';
import type { CommentThread } from '../comments/conversation.ts';
import type { Document } from '../content/document.ts';
import { commentPageHref } from '../content/guids.ts';
import { authorContext } from '../site/authors.ts';
import type { User } from '../site/users.ts';
import { documentContext } from './context.ts';
import type { DocumentContext } from './context.ts';
import type { PageContexts } from './page-context.ts';
import type { Listing, RenderDeps, SearchPage, WikiIndexPage } from './render.ts';
import { snippetHtml } from './search.ts';
import type { ThemeRender } from './theme-environment.ts';
import { OPTIONAL_TEMPLATES, TEMPLATES, themeTemplate } from './theme-templates.ts';

export interface ListingPages {
  renderListing(listing: Listing): string;
  renderSearch(search: SearchPage): string;
  renderWikiIndex(index: WikiIndexPage): string;
  renderComment(thread: CommentThread): string;
}

export function createListingPages(
  deps: RenderDeps,
  render: ThemeRender,
  contexts: PageContexts,
): ListingPages {
  const { config, users, citedPage } = deps;

  function renderListing(listing: Listing): string {
    const people = users();
    const bodyLeads = listing.document?.html.includes('<img') === true;
    const items: DocumentContext[] = listing.documents.map((document, index) =>
      contexts.entryContext(document, people, { lead: !bodyLeads && index === 0 }),
    );
    const document = postsPageDocument(deps, listing.document, people, bodyLeads);

    return render(listingTemplate(deps, listing), {
      ...document,
      title: listing.title,
      url: listing.url,
      page: { ...document?.page, url: listing.url },
      ...contexts.capsuleContext(listing.url),
      // `posts` is the friendly name a theme loops over; `pagination.items`
      // is the same array under the name Eleventy gives it.
      posts: items,
      pagination: { ...listing.pagination, items },
      ...(listing.tag === undefined ? {} : { tag: listing.tag }),
      ...(listing.category === undefined ? {} : { category: listing.category }),
      ...(listing.author === undefined
        ? {}
        : { author: listing.author, siteAuthor: listing.author }),
    });
  }

  function renderSearch(search: SearchPage): string {
    const people = users();
    const items = search.hits.map((hit) => ({
      ...documentContext(
        hit.document,
        config,
        authorContext(people, hit.document.author),
        undefined,
        citedPage,
      ),
      snippet: snippetHtml(hit.snippet),
    }));

    return render(TEMPLATES.search, {
      title: search.query === '' ? 'Search' : `Search results for “${search.query}”`,
      url: search.url,
      page: { url: search.url },
      ...contexts.capsuleContext(search.url),
      query: search.query,
      posts: items,
      pagination: { ...search.pagination, items },
    });
  }

  function renderWikiIndex({ title, url, groups }: WikiIndexPage): string {
    const people = users();
    return render(TEMPLATES.wikiIndex, {
      title,
      url,
      page: { url },
      ...contexts.capsuleContext(url),
      wikiGroups: groups.map(({ letter, pages }) => ({
        letter,
        pages: pages.map((document) => contexts.entryContext(document, people, { lead: false })),
      })),
    });
  }

  function renderComment({ post, comment, ancestors }: CommentThread): string {
    const url = commentPageHref(comment.id);
    const on = contexts.entryContext(post, users(), { lead: false });
    return render(TEMPLATES.comment, {
      title: `${comment.author.name} on ${on.label}`,
      url,
      page: { url },
      ...contexts.capsuleContext(url),
      noindex: true,
      comment,
      ancestors,
      post: on,
      threadUrl: `${post.permalink}#${commentAnchor(comment.id)}`,
    });
  }

  return { renderListing, renderSearch, renderWikiIndex, renderComment };
}

function listingTemplate({ themes }: Pick<RenderDeps, 'themes'>, listing: Listing): string {
  if (listing.template !== undefined) return listing.template;
  if (listing.document === undefined) return TEMPLATES.home;
  return themeTemplate(themes.current().dirs, OPTIONAL_TEMPLATES.postsPage, TEMPLATES.home);
}

function postsPageDocument(
  { config, citedPage }: Pick<RenderDeps, 'config' | 'citedPage'>,
  page: Document | undefined,
  people: readonly User[],
  bodyLeads: boolean,
): DocumentContext | undefined {
  return page === undefined
    ? undefined
    : documentContext(
        page,
        config,
        authorContext(people, page.author),
        { lead: bodyLeads },
        citedPage,
      );
}
