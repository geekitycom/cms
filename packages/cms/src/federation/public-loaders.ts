import {
  getAuthenticatedDocumentLoader,
  getDocumentLoader,
  kvCache,
  preloadedContexts,
  UrlError,
} from '@fedify/fedify';
import type {
  DocumentLoader,
  FederationOptions,
  HttpMessageSignaturesSpec,
  HttpMessageSignaturesSpecDeterminer,
  KvStore,
} from '@fedify/fedify';

import { publicHost } from '../util/public-address.ts';
import type { HostLookup } from '../util/public-address.ts';

type LoaderFactories = Required<
  Pick<
    FederationOptions<unknown>,
    'documentLoaderFactory' | 'contextLoaderFactory' | 'authenticatedDocumentLoaderFactory'
  >
>;

const SPEC_PREFIX = ['_fedify', 'httpMessageSignaturesSpec'] as const;

/**
 * Fedify's own loaders, as it builds them by default, with each URL's host
 * first checked by {@link publicHost} through `lookup`, so the addresses an
 * operator denied are refused as well as the private ones Fedify knows.
 *
 * Only the URL a loader is handed is checked this way: a redirect it follows
 * is checked by Fedify alone.
 */
export function publicLoaders(lookup: HostLookup, kv: KvStore): LoaderFactories {
  const guard =
    (loader: DocumentLoader): DocumentLoader =>
    async (url, options) => {
      if (
        !(url in preloadedContexts) &&
        !(await publicHost(new URL(url).hostname, lookup, options?.signal))
      ) {
        throw new UrlError(`${url} is not on a public address`);
      }
      return await loader(url, options);
    };

  const specDeterminer: HttpMessageSignaturesSpecDeterminer = {
    determineSpec: async (origin) =>
      (await kv.get<HttpMessageSignaturesSpec>([...SPEC_PREFIX, origin])) ?? 'rfc9421',
    rememberSpec: async (origin, spec) => {
      await kv.set([...SPEC_PREFIX, origin], spec, { ttl: Temporal.Duration.from({ days: 90 }) });
    },
  };

  const cached =
    (kind: 'object' | 'context'): LoaderFactories['documentLoaderFactory'] =>
    (options) =>
      kvCache({
        loader: guard(getDocumentLoader({ ...options, allowPrivateAddress: false })),
        kv,
        kind,
      });

  return {
    documentLoaderFactory: cached('object'),
    contextLoaderFactory: cached('context'),
    authenticatedDocumentLoaderFactory: (identity, options) =>
      guard(
        getAuthenticatedDocumentLoader(identity, {
          ...options,
          allowPrivateAddress: false,
          specDeterminer,
        }),
      ),
  };
}
