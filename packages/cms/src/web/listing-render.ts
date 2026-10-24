import { commentAnchor } from '../comments/conversation.ts';
import type { CommentThread } from '../comments/conversation.ts';
import type { Document } from '../content/document.ts';
import { commentPageHref } from '../content/guids.ts';
import { authorContext } from '../site/authors.ts';
import type { User } from '../site/users.ts';
import { documentContext } from './context.ts';
import type { DocumentContext } from './context.ts';
import type { PageContexts } from './page-context.ts';
import type { Listing, RenderDeps, SearchPage } from './render.ts';
import { snippetHtml } from './search.ts';
import type { ThemeRender } from './theme-environment.ts';
import { OPTIONAL_TEMPLATES, TEMPLATES, themeTemplate } from './theme-templates.ts';

export interface ListingPages {
  renderListing(listing: Listing): string;
  renderSearch(search: SearchPage): string;
  renderComment(thread: CommentThread): string;
}

/** The pages that list documents: listings, search results and a comment's own page. */
export function createListingPages(
  deps: RenderDeps,
  render: ThemeRender,
  contexts: PageContexts,
): ListingPages {
  const { config, users, citedPage } = deps;

  function renderListing(listing: Listing): string {
    // One read of the users file for the whole page, however many posts are
    // on it: every byline on a listing resolves against the same list.
    const people = users();
    // The first image on the page is fetched at once: the posts page's own
    // when its body has one, since it is printed above the list, else the
    // first entry's.
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
      // On an author archive this is the person the archive is of, and it
      // goes on last so it wins over the posts page's own `author`, which is
      // the page's writer rather than whose archive this is. They are also
      // whose page this is, so the identity a theme prints is theirs rather
      // than the site's.
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
      // Escaped here and marked up here, so a theme prints it with `safe`
      // and cannot get the order of the two wrong.
      snippet: snippetHtml(hit.snippet),
    }));

    return render(TEMPLATES.search, {
      title: search.query === '' ? 'Search' : `Search results for “${search.query}”`,
      url: search.url,
      page: { url: search.url },
      ...contexts.capsuleContext(search.url),
      // The words as the reader typed them, for the form to put back in the
      // box and the heading to repeat. Autoescaped like any other string.
      query: search.query,
      posts: items,
      pagination: { ...search.pagination, items },
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

  return { renderListing, renderSearch, renderComment };
}

/**
 * Which template one listing renders through: whatever it named, the posts
 * page's own template when it is one and the theme ships one, and the home
 * layout otherwise.
 */
function listingTemplate({ themes }: Pick<RenderDeps, 'themes'>, listing: Listing): string {
  if (listing.template !== undefined) return listing.template;
  if (listing.document === undefined) return TEMPLATES.home;
  return themeTemplate(themes.current().dirs, OPTIONAL_TEMPLATES.postsPage, TEMPLATES.home);
}

/**
 * The posts page's own front matter and rendered body, under the listing's
 * title, URL and posts: a theme prints `{{ content | safe }}` above the list
 * and a site without a posts page has nothing there. The listing's own keys go
 * on after it, because this page of the listing is what is being served — page
 * two of it is not the page's own URL.
 */
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
