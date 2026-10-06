import type { Context, DocumentLoader } from '@fedify/fedify';

import { primaryUser } from '../admin/accounts.ts';
import { senderKeyPairs } from './actor.ts';
import type { FederationContextData } from './federation.ts';

export interface SiteLoaders {
  readonly documentLoader: DocumentLoader;
  readonly contextLoader: DocumentLoader;
}

/**
 * The loaders the site reads a stranger's fediverse documents with: signed as
 * its first account, because mastodon.social, like any server in authorized
 * fetch mode, answers an unsigned request for an actor or a status with a
 * 401. A site with no account yet reads unsigned. Every document fetched
 * through them stops at `signal`.
 */
export async function siteLoaders(
  context: Context<FederationContextData>,
  signal?: AbortSignal,
): Promise<SiteLoaders> {
  const signer = primaryUser(context.data.config.dataDir);
  const [key] = signer === undefined ? [] : await senderKeyPairs(context, signer);
  const loader = key === undefined ? context.documentLoader : context.getDocumentLoader(key);
  return {
    documentLoader:
      signal === undefined ? loader : (url, options) => loader(url, { ...options, signal }),
    contextLoader: context.contextLoader,
  };
}
