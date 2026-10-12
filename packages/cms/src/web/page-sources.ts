import { commentFormFor } from '../comments/routes.ts';
import type { ResolvedConfig } from '../config.ts';
import { contactFormFor } from '../contact/form.ts';
import type { Document } from '../content/document.ts';
import { shareLocation } from '../content/location.ts';
import { postLocations } from '../content/locations.ts';
import type { RedirectSource } from '../content/redirects.ts';
import type {
  ArchiveReader,
  BacklinkReader,
  CatalogReader,
  DocumentLookup,
} from '../content/store.ts';
import { readSiteSettings } from '../site/site-json.ts';
import { listUsers } from '../site/users.ts';
import {
  selectedTargets,
  syndicationCopies,
  syndicationTargetsReader,
} from '../webmention/syndication.ts';
import { frontPageSlugs } from '../theme/site-data.ts';
import type { SiteDataSource } from '../theme/site-data.ts';
import type { CreateRendererOptions } from './render.ts';

export interface PageSourcesOptions {
  readonly config: ResolvedConfig;
  readonly store: DocumentLookup & ArchiveReader & BacklinkReader & CatalogReader;
  readonly redirects: RedirectSource;
  readonly siteData: SiteDataSource;
  readonly mailConfigured: () => boolean;
}

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

function isHomepage(store: DocumentLookup, siteData: SiteDataSource, document: Document): boolean {
  if (document.type !== 'page') return false;
  const { homepage } = frontPageSlugs(siteData.read());
  return homepage !== '' && store.getBySlug(homepage)?.path === document.path;
}
