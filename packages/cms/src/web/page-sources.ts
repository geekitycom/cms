import { commentFormFor } from '../comments/routes.ts';
import type { ResolvedConfig } from '../config.ts';
import { contactFormFor } from '../contact/form.ts';
import type { Document } from '../content/document.ts';
import { shareLocation } from '../content/location.ts';
import { postLocations } from '../content/locations.ts';
import type { ContentStore } from '../content/store.ts';
import { readSiteSettings } from '../site/site-json.ts';
import { listUsers } from '../site/users.ts';
import {
  selectedTargets,
  syndicationCopies,
  syndicationTargetsReader,
} from '../webmention/syndication.ts';
import { frontPageSlugs } from './context.ts';
import type { SiteDataSource } from './context.ts';
import type { RedirectSource } from './redirects.ts';
import type { CreateRendererOptions } from './render.ts';

/** What {@link pageSources} reads a site's pages out of. */
export interface PageSourcesOptions {
  readonly config: ResolvedConfig;
  readonly store: ContentStore;
  readonly redirects: RedirectSource;
  readonly siteData: SiteDataSource;
  /** Whether the site can send mail, which is whether the comment form offers notices. */
  readonly mailConfigured: () => boolean;
}

/** The parts of a page the renderer asks the site's files and index for. */
export type PageSources = Required<
  Pick<
    CreateRendererOptions,
    | 'syndication'
    | 'location'
    | 'pages'
    | 'users'
    | 'commentForm'
    | 'contactForm'
    | 'neighbours'
    | 'backlinks'
    | 'newestPosts'
    | 'archivePosts'
  >
>;

/**
 * What a site's pages are drawn with besides the document itself, each read
 * per render so that a save, a setting or a clock tick shows on the very next
 * request.
 */
export function pageSources({
  config,
  store,
  redirects,
  siteData,
  mailConfigured,
}: PageSourcesOptions): PageSources {
  const syndicationTargets = syndicationTargetsReader(config.contentDir);
  const copies = syndicationCopies(config.contentDir);
  const locations = postLocations(config.dataDir);

  return {
    syndication: (document) => ({
      targets: selectedTargets(
        document,
        syndicationTargets(),
        readSiteSettings(config.contentDir).language,
      ),
      copies: Object.values(copies.read(document.permalink)),
    }),
    location: (document) =>
      shareLocation(
        locations.read(document.permalink),
        readSiteSettings(config.contentDir).locationSharing,
      ),
    // The pages that put themselves in the site menu are found by asking for
    // every public page rather than by an index of their own: a site has a
    // handful, and a page flagged in the editor is in the menu at once.
    pages: () => store.listAll({ type: 'page', draft: false, trashed: false, scheduled: false }),
    users: () => listUsers(config.dataDir),
    commentForm: (document, viewer) =>
      commentFormFor({
        document,
        site: siteData.read(),
        now: config.now(),
        viewer,
        notifiable: mailConfigured(),
      }),
    contactForm: (document) => contactFormFor({ document, now: config.now() }),
    neighbours: (document) => store.neighbours(document),
    backlinks: (document) =>
      store.listBacklinks(document, {
        redirects: redirects.current(),
        home: isHomepage(store, siteData, document),
      }),
    newestPosts: (count) => store.listPosts({ limit: count }),
    archivePosts: () => store.listPosts(),
  };
}

/**
 * Whether a document is the page the Reading setting serves at `/`, so a link
 * to `/` is a backlink to it, as the routes resolve it.
 */
function isHomepage(store: ContentStore, siteData: SiteDataSource, document: Document): boolean {
  if (document.type !== 'page') return false;
  const { homepage } = frontPageSlugs(siteData.read());
  return homepage !== '' && store.getBySlug(homepage)?.path === document.path;
}
