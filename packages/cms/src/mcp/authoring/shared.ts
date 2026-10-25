import { userForAuthor } from '../../content/authors.ts';
import type { Document } from '../../content/document.ts';
import { keptProperties } from '../../content/kept-properties.ts';
import { postLocations } from '../../content/locations.ts';
import type { WriteOutcome } from '../../content/write.ts';
import type { SourceSite } from '../../content/micropub-update.ts';
import { listUsers } from '../../site/users.ts';
import type { User } from '../../site/users.ts';
import { findPost } from '../inspect/post.ts';
import { isRefused, refused } from '../tools.ts';
import type { Refused, ToolSite } from '../tools.ts';

export function ownPost(site: ToolSite, user: User, reference: string): Document | Refused {
  const document = findPost(site, reference);
  if (isRefused(document)) return document;
  const author = userForAuthor(listUsers(site.config.dataDir), document.author);
  if (author !== undefined && author.id !== user.id) {
    return refused(`${reference} is not your post.`);
  }
  return document;
}

export function sourceSite(site: ToolSite): SourceSite {
  return {
    baseUrl: site.config.baseUrl,
    targets: site.siteRecords.syndicationTargets(),
    locations: postLocations(site.config.dataDir),
    kept: keptProperties(site.config.dataDir),
  };
}

export function unsaved(
  written: Exclude<WriteOutcome, { outcome: 'saved' }>,
  slug: string,
): Refused {
  return written.outcome === 'refused'
    ? refused(written.message)
    : refused(
        `${slug} changed since it was read. Read it again with get_post_source and update from what it holds now.`,
      );
}

export const POST_WRITTEN = {
  url: { type: 'string', description: 'The post’s address.' },
  slug: { type: 'string' },
  draft: { type: 'boolean' },
} as const;
