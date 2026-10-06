import type { Context } from '@fedify/fedify';
import { isActor } from '@fedify/vocab';

import { isWebUrl } from '../content/enclosure.ts';
import { handleDirectory, rememberHandles } from '../content/handles.ts';
import type { ResolvedHandle } from '../content/handles.ts';
import { handlesIn } from '../content/markdown.ts';
import type { FederationContextData } from './federation.ts';
import { siteLoaders } from './site-loaders.ts';

/** How long one save waits for the handles it names to resolve. */
export const HANDLE_TIMEOUT_MS = 5_000;

/** Resolve and store the handles a body names that the directory does not know yet. */
export type HandleLearner = (body: string) => Promise<void>;

/**
 * The site's {@link HandleLearner} (TASK-194): WebFinger for each new
 * `@user@host`, then the actor it points at, fetched signed as the site's first
 * account for a server in authorized fetch mode.
 *
 * It runs before the file is written, so the first parse of the post already
 * links the handle and its first `Create` already mentions the account. A
 * handle that does not resolve in time is left out and asked about again at
 * the next save; the save itself never fails over one.
 */
export function handleLearner(
  contextOf: () => Context<FederationContextData>,
  logger: { warn(message: string): void } = console,
): HandleLearner {
  return async (body) => {
    const context = contextOf();
    const { contentDir } = context.data.config;
    const known = handleDirectory(contentDir);
    const unknown = handlesIn(body).filter((handle) => known(handle) === undefined);
    if (unknown.length === 0) return;

    const signal = AbortSignal.timeout(HANDLE_TIMEOUT_MS);
    const options = { ...(await siteLoaders(context, signal)), signal };

    const resolved = await Promise.all(
      unknown.map(async (handle): Promise<[string, ResolvedHandle] | undefined> => {
        try {
          const actor = await context.lookupObject(`@${handle}`, options);
          if (!isActor(actor) || actor.id === null || actor.inboxId === null) {
            logger.warn(`@${handle} did not resolve to a fediverse account.`);
            return undefined;
          }
          const url = (actor.url instanceof URL ? actor.url : actor.url?.href)?.href;
          const sharedInbox = actor.endpoints?.sharedInbox?.href;
          return [
            handle,
            {
              profile: url !== undefined && isWebUrl(url) ? url : actor.id.href,
              actor: actor.id.href,
              inbox: actor.inboxId.href,
              ...(sharedInbox === undefined ? {} : { sharedInbox }),
            },
          ];
        } catch (thrown) {
          logger.warn(`Could not resolve @${handle}: ${String(thrown)}`);
          return undefined;
        }
      }),
    );
    const found = resolved.filter((entry) => entry !== undefined);
    if (found.length > 0) await rememberHandles(contentDir, Object.fromEntries(found));
  };
}

/** One account a post mentions: the handle as `user@host` and what it resolved to. */
export interface MentionedAccount {
  readonly handle: string;
  readonly account: ResolvedHandle;
}

/** The resolved accounts a post's body mentions, in the order it names them. */
export function mentionedAccounts(body: string, contentDir: string): MentionedAccount[] {
  const directory = handleDirectory(contentDir);
  return handlesIn(body).flatMap((handle) => {
    const account = directory(handle);
    return account === undefined ? [] : [{ handle, account }];
  });
}
