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
  const stampMark = `geekity-stamp-${randomUUID()}`;

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
      template: themeTemplate(
        deps.themes.current().dirs,
        OPTIONAL_TEMPLATES.frontPage,
        TEMPLATES.page,
      ),
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
  const writer = authorContext(users(), document.author);
  const context = documentContext(document, config, writer, { lead: true }, citedPage);
  const url = servedAt ?? context.url;
  const now = config.now();
  const objectId = objectIdOf(deps, document, now);
  const settings = requestSite();
  const either = options.neighbours?.(document) ?? {};
  const shared = options.location?.(document, settings);

  return {
    ...context,
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
    ...(isServed(document, now) ? { commentsFeed: commentsFeedPath(document.permalink) } : {}),
    ...contexts.archiveContext(document),
    ...responseContext(deps, document, settings, viewer, stamps),
    ...contexts.citedBy(document),
    ...syndicationContext(deps, document, settings),
    ...(shared === undefined ? {} : { location: locationContext(shared) }),
    ...(visibilityOf(document) === 'unlisted' ? { noindex: true } : {}),
    ...extra,
  };
}

function objectIdOf({ config }: RenderDeps, document: Document, now: Date): string | undefined {
  const naturalId = activityStreamsId(document, config.baseUrl, now);
  return naturalId === undefined
    ? undefined
    : currentObjectId(readObjectIds(config.contentDir), naturalId);
}

function responseContext(
  { options, siteData }: RenderDeps,
  document: Document,
  settings: SiteSettings,
  viewer: CommentViewer | undefined,
  stamps: Stamps,
): Record<string, unknown> {
  const said = options.conversation?.(document, settings);
  const form = stamps.hold(
    options.commentForm?.(document, viewer, requestMailConfigured()),
    'comment',
  );
  const contact = stamps.hold(options.contactForm?.(document), 'contact');
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
      const printed = held.filter(([mark]) => drawn.includes(mark));
      return {
        html: printed.reduce((html, [mark, loaded]) => html.replaceAll(mark, loaded), drawn),
        fingerprint: [
          withRestartStableMark(drawn, stampMark),
          ...printed.map(([, loaded]) => stampWindowOf(loaded)),
        ].join('\n'),
      };
    },
  };
}

function withRestartStableMark(drawn: string, stampMark: string): string {
  return drawn.replaceAll(stampMark, 'geekity-stamp');
}

function stampWindowOf(loaded: string): string {
  return String(Math.floor(Number(loaded) / STAMP_WINDOW_MS));
}
