import { existsSync } from 'node:fs';

import { commentsFile } from '../comments/records.ts';
import type { ResolvedConfig } from '../config.ts';
import type { SiteRecords } from '../content/write.ts';
import { readSiteSettings } from '../site/site-json.ts';
import { listUsers } from '../site/users.ts';
import { syndicationTargetsReader } from '../webmention/syndication.ts';

/** The records a write reads about the site, from the files that keep them. */
export function siteRecords(config: Pick<ResolvedConfig, 'contentDir' | 'dataDir'>): SiteRecords {
  const syndicationTargets = syndicationTargetsReader(config.contentDir);
  return {
    users: () => listUsers(config.dataDir),
    timezone: () => readSiteSettings(config.contentDir).timezone,
    syndicationTargets: () => syndicationTargets(),
    hasComments: (slug) => existsSync(commentsFile(config.contentDir, slug)),
  };
}
