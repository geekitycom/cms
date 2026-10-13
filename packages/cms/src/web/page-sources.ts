import { commentFormFor } from '../comments/page-form.ts';
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
}: PageSourcesOptions): PageSources {
  const syndicationTargets = syndicationTargetsReader(config.contentDir);
  const copies = syndicationCopies(config.contentDir);
  const locations = postLocations(config.dataDir);

  return {
    syndication: (document, site) => ({
      targets: selectedTargets(document, syndicationTargets(), site.language),
      copies: Object.values(copies.read(document.permalink)),
    }),
    location: (document, site) =>
      shareLocation(locations.read(document.permalink), site.location_sharing),
    pages: () => store.listAll({ type: 'page', draft: false, trashed: false, scheduled: false }),
    users: () => listUsers(config.dataDir),
    commentForm: (document, viewer, notifiable) =>
      commentFormFor({
        document,
        site: siteData.read(),
        now: config.now(),
        viewer,
        notifiable,
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
