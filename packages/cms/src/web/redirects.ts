import type { MiddlewareHandler } from 'hono';

import type { GeekityEnv } from '../env.ts';

/** What `X-Redirect-By` says on every redirect the CMS sends. */
export const REDIRECT_BY = 'Geekity CMS';

/**
 * Stamp `X-Redirect-By` on every redirect the CMS answers with, whichever part
 * of it sent one, so somebody tracing a chain of redirects through a proxy can
 * tell this layer's from the others'.
 */
export const redirectBy: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  await next();
  if (c.res.status >= 300 && c.res.status < 400 && c.res.headers.has('Location')) {
    c.res.headers.set('X-Redirect-By', REDIRECT_BY);
  }
};
