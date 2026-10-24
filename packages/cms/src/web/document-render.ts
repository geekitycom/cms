import { randomUUID } from 'node:crypto';

import type { CommentViewer } from '../comments/form.ts';
import type { Document } from '../content/document.ts';
import { activityStreamsId } from '../content/permalinks.ts';
import { isServed } from '../content/served.ts';
import { visibilityOf } from '../content/visibility.ts';
import { currentObjectId, readObjectIds } from '../federation/object-ids.ts';
import { MAXIMUM_FORM_AGE_SECONDS } from '../forms/protection.ts';
import { authorContext } from '../site/authors.ts';
import type { SiteSettings } from '../site/settings.ts';
import { pingbackEndpointFor } from '../webmention/pingback.ts';
import { webmentionEndpointFor } from '../webmention/endpoint.ts';
import { handSyndicationOf } from '../webmention/syndication.ts';
import { backlinkContext, documentContext, locationContext, syndicationLinks } from './context.ts';
import { commentsFeedPath } from './feeds.ts';
import { neighbourContext } from './page-context.ts';
import type { PageContexts } from './page-context.ts';
import type { RenderDeps, RenderedPage, RenderPageOptions } from './render.ts';
import { requestMailConfigured, requestSite } from './render-scope.ts';
import type { ThemeRender } from './theme-environment.ts';
import { OPTIONAL_TEMPLATES, TEMPLATES, themeTemplate } from './theme-templates.ts';

/** Half the time a form stays submittable: the oldest stamp a 304 hands back. */
const STAMP_WINDOW_MS = (MAXIMUM_FORM_AGE_SECONDS * 1000) / 2;

interface DocumentPageOptions {
  template: string;
  url?: string | undefined;
  extra: Record<string, unknown>;
  viewer?: CommentViewer | undefined;
}

export interface DocumentPages {
  readonly renderPage: (document: Document, options: RenderPageOptions) => RenderedPage;
}

export function createDocumentPages(
  deps: RenderDeps,
  render: ThemeRender,
  contexts: PageContexts,
): DocumentPages {
  // What a form's loaded-at stamp is drawn as while its page is fingerprinted.
  // Random per renderer so no post, reply or theme text can spell it.
  const stampMark = `geekity-stamp-${randomUUID()}`;

  /**
   * One document through one template, with everything a page of the theme is
   * given: its own context, its ActivityStreams id, its conversation, its
   * forms and its webmention endpoint.
   *
   * The template and the URL are arguments because the front page is the same
   * page rendered somewhere else: `renderDocument` and `renderFrontPage` are
   * this with two different answers to "which layout, and at which URL".
   */
  function documentPage(document: Document, page: DocumentPageOptions): RenderedPage {
    const stamps = createStamps(stampMark);
    const context = documentPageContext(deps, contexts, document, page, stamps);
    return stamps.fingerprinted(render(page.template, context));
  }

  function renderPage(
    document: Document,
    { frontPage = false, extra = {}, viewer }: RenderPageOptions,
  ): RenderedPage {
    if (!frontPage) {
      return documentPage(document, {
        template: document.type === 'post' ? TEMPLATES.post : TEMPLATES.page,
        extra,
        viewer,
      });
    }
    return documentPage(document, {
      // A theme's own front page if it has written one, and the layout every
      // other page uses if it has not.
      template: themeTemplate(
        deps.themes.current().dirs,
        OPTIONAL_TEMPLATES.frontPage,
        TEMPLATES.page,
      ),
      // At `/`, which is where it is being read: the canonical link, the
      // menu's current item and anything else a theme takes off `page.url`
      // should say the URL this is served at rather than the one that
      // redirects here.
      url: '/',
      extra: { ...contexts.newestPostsContext(document), ...contexts.postsPageContext(), ...extra },
      viewer,
    });
  }

  return { renderPage };
}

function documentPageContext(
  deps: RenderDeps,
  contexts: PageContexts,
  document: Document,
  { url: servedAt, extra, viewer }: DocumentPageOptions,
  stamps: Stamps,
): Record<string, unknown> {
  const { config, options, users, citedPage } = deps;
  // The profile behind the document's `author`, resolved here rather than in
  // `documentContext` for the reason the object id is: it needs the site's
  // users, which a document on its own does not carry.
  const writer = authorContext(users(), document.author);
  const context = documentContext(document, config, writer, { lead: true }, citedPage);
  // The URL it is being served at, which is its own permalink everywhere but
  // the front page.
  const url = servedAt ?? context.url;
  const now = config.now();
  const objectId = objectIdOf(deps, document, now);
  const settings = requestSite();
  // The posts either side of this one, as the two links a theme draws under
  // an entry (TASK-79). Each is on the context only when there is one, so a
  // theme asks `{% if previous %}` and the ends of the archive draw nothing.
  const either = options.neighbours?.(document) ?? {};
  const shared = options.location?.(document, settings);

  return {
    ...context,
    // This page's own person, which is the site's author everywhere else:
    // the byline and the identity a theme prints are one object, so what a
    // reader sees and what the structured data says cannot drift.
    ...(writer === undefined ? {} : { siteAuthor: writer }),
    ...neighbourContext('previous', either.previous, citedPage),
    ...neighbourContext('next', either.next, citedPage),
    backlinks: (options.backlinks?.(document) ?? []).map((linking) =>
      backlinkContext(linking, citedPage),
    ),
    url,
    page: { ...context.page, url },
    ...contexts.capsuleContext(url),
    ...(objectId === undefined ? {} : { activityStreams: objectId }),
    // `commentsFeed` is where the conversation is syndicated, for a served
    // document, and is set here rather than in a layout so that a site which
    // overrides `post.njk` or `page.njk` keeps the link.
    ...(isServed(document, now) ? { commentsFeed: commentsFeedPath(document.permalink) } : {}),
    // And the whole archive, for a page whose front matter asked for it
    // (TASK-85). On the context only for that page, so a theme asks
    // `{% if archiveMonths %}` exactly as it asks about the contact form.
    ...contexts.archiveContext(document),
    ...responseContext(deps, document, settings, viewer, stamps),
    ...contexts.citedBy(document),
    ...syndicationContext(deps, document, settings),
    ...(shared === undefined ? {} : { location: locationContext(shared) }),
    ...(visibilityOf(document) === 'unlisted' ? { noindex: true } : {}),
    ...extra,
  };
}

/**
 * `activityStreams` is the object id the base layout advertises. It is worked
 * out here rather than in `documentContext` because it needs the site's base
 * URL, which a document on its own does not carry.
 */
function objectIdOf({ config }: RenderDeps, document: Document, now: Date): string | undefined {
  const naturalId = activityStreamsId(document, config.baseUrl, now);
  return naturalId === undefined
    ? undefined
    : currentObjectId(readObjectIds(config.contentDir), naturalId);
}

/** What was said back to a document, and the ways a reader can answer it. */
function responseContext(
  { options, siteData }: RenderDeps,
  document: Document,
  settings: SiteSettings,
  viewer: CommentViewer | undefined,
  stamps: Stamps,
): Record<string, unknown> {
  // `conversation` is what was said back. It is on the context only when
  // there is something in it, so a theme can ask `{% if conversation %}`
  // and a post nobody has answered renders no empty section (TASK-49).
  const said = options.conversation?.(document, settings);
  // `commentForm` is on the context only when the post is open, so the
  // theme asks `{% if commentForm %}` rather than working the rules out
  // for itself — and a closed post shows the thread with no form.
  const form = stamps.hold(
    options.commentForm?.(document, viewer, requestMailConfigured()),
    'comment',
  );
  // And the contact form, when the page's front matter asked for one
  // (TASK-56). Nothing about where a message would go is on the context:
  // the address is read when a submission arrives, so a theme cannot
  // print it however it is written.
  const contact = stamps.hold(options.contactForm?.(document), 'contact');
  // Where a webmention about this page is sent (TASK-51). On the context
  // only when the site takes them, so a theme asks `{% if webmention %}`
  // and a site that has turned them off advertises nothing.
  const site = siteData.read();
  const webmention = webmentionEndpointFor(site);
  const pingback = pingbackEndpointFor(site);
  return {
    ...(said === undefined || said.counts.total === 0 ? {} : { conversation: said }),
    ...(form === undefined ? {} : { commentForm: form }),
    ...(contact === undefined ? {} : { contactForm: contact }),
    ...(webmention === undefined ? {} : { webmention }),
    ...(pingback === undefined ? {} : { pingback }),
  };
}

/**
 * The targets this post links to and the copies they made of it (TASK-155):
 * the links a target verifies sit inside the h-entry, so they are on the
 * post's own page, which is the page a target fetches.
 */
function syndicationContext(
  { options }: RenderDeps,
  document: Document,
  settings: SiteSettings,
): Record<string, unknown> {
  const syndicated = options.syndication?.(document, settings);
  return {
    syndicateTo: syndicated?.targets ?? [],
    syndication: syndicationLinks([
      ...handSyndicationOf(document.extra),
      ...(syndicated?.copies ?? []),
    ]),
  };
}

interface Stamps {
  hold<Form extends { loaded: string }>(form: Form | undefined, key: string): Form | undefined;
  fingerprinted(drawn: string): RenderedPage;
}

/**
 * The forms' loaded-at stamps of one drawing of a page: each form is drawn
 * with a mark in place of its stamp, so the page can be fingerprinted without
 * the clock and the stamps put back afterwards.
 */
function createStamps(stampMark: string): Stamps {
  const held: [mark: string, loaded: string][] = [];
  return {
    hold(form, key) {
      if (form === undefined) return undefined;
      const mark = `${stampMark}-${key}`;
      held.push([mark, form.loaded]);
      return { ...form, loaded: mark };
    },
    fingerprinted(drawn) {
      // Only a stamp the theme printed can go stale in a reader's browser.
      const printed = held.filter(([mark]) => drawn.includes(mark));
      return {
        html: printed.reduce((html, [mark, loaded]) => html.replaceAll(mark, loaded), drawn),
        fingerprint: [
          // The mark is random per renderer; a restart must not change every ETag.
          drawn.replaceAll(stampMark, 'geekity-stamp'),
          ...printed.map(([, loaded]) => String(Math.floor(Number(loaded) / STAMP_WINDOW_MS))),
        ].join('\n'),
      };
    },
  };
}
