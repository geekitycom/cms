import { federation as federationMiddleware } from '@fedify/hono';
import type { Context, Hono } from 'hono';

import type { GeekityEnv } from '../env.ts';
import type { SiteFederation } from './federation.ts';

/**
 * Put Fedify in front of the rest of the app.
 *
 * The middleware only answers the paths Fedify registered — the actor, its
 * collections, WebFinger and NodeInfo — plus content URLs asked for as
 * ActivityStreams; everything else falls through to `next()` and reaches the
 * admin and the public site as before. That is why it is mounted first: the
 * public site claims every unmatched path in its not-found handler, so
 * anything registered after it never sees a request.
 *
 * The dispatchers are handed the stores off the Hono context rather than
 * closing over them, so one federation object could serve more than one CMS
 * and so a dispatcher is never reading a store the request did not come with.
 */
export function mountFederation(app: Hono<GeekityEnv>, federation: SiteFederation): void {
  // `@fedify/hono` types its context as the two properties it actually reads,
  // which is looser than Hono's own; the cast is what puts `c.var` back.
  app.use(
    '*',
    federationMiddleware(federation, (context) => {
      const c = context as unknown as Context<GeekityEnv>;
      return { admin: c.var.admin, store: c.var.store, config: c.var.config };
    }),
  );
}
