import type { Context } from 'hono';

import type { DocumentSite } from '../content/write.ts';
import { findUserById } from '../site/users.ts';
import type { GeekityEnv } from './env.ts';

type WriteVariables = Pick<
  GeekityEnv['Variables'],
  | 'siteRecords'
  | 'store'
  | 'config'
  | 'announce'
  | 'replyContexts'
  | 'learnHandles'
  | 'siteAtRequestStart'
>;

/**
 * The write path as one request reaches it, writing as `writer`: by default
 * whoever the admin session names.
 */
export function documentSite(
  c: Context<GeekityEnv>,
  writer: string | undefined = currentUsername(c),
): DocumentSite {
  return documentSiteFrom(c.var, writer);
}

export function documentSiteFrom(
  variables: WriteVariables,
  writer: string | undefined,
): DocumentSite {
  return {
    ...variables.siteRecords,
    store: variables.store,
    config: variables.config,
    announce: variables.announce,
    writer,
    timezone: variables.siteAtRequestStart.timezone,
    citedContext: (target) => variables.replyContexts.describe(target),
    storedContext: (target) => variables.replyContexts.read(target, variables.siteAtRequestStart),
    learnHandles: variables.learnHandles,
  };
}

/** The signed-in user's login, which is what doc-2's `author` holds. */
export function currentUsername(c: Context<GeekityEnv>): string | undefined {
  const userId = c.var.session?.userId;
  if (userId == null) return undefined;
  return findUserById(c.var.config.dataDir, userId)?.username;
}
