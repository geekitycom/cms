import type { Context } from 'hono';

import type { DocumentSite } from '../content/write.ts';
import { findUserById } from '../site/users.ts';
import type { GeekityEnv } from './env.ts';

/**
 * The write path as one request reaches it, writing as `writer`: by default
 * whoever the admin session names.
 */
export function documentSite(
  c: Context<GeekityEnv>,
  writer: string | undefined = currentUsername(c),
): DocumentSite {
  return {
    ...c.var.siteRecords,
    store: c.var.store,
    config: c.var.config,
    announce: c.var.announce,
    writer,
    citedContext: (target) => c.var.replyContexts.describe(target),
    storedContext: (target) => c.var.replyContexts.read(target),
    learnHandles: c.var.learnHandles,
  };
}

/** The signed-in user's login, which is what doc-2's `author` holds. */
export function currentUsername(c: Context<GeekityEnv>): string | undefined {
  const userId = c.var.session?.userId;
  if (userId == null) return undefined;
  return findUserById(c.var.config.dataDir, userId)?.username;
}
