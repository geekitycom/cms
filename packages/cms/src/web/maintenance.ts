import type { Context, MiddlewareHandler } from 'hono';

import { ADMIN_PREFIX } from '../admin/session.ts';
import { signedInCommenter } from '../comments/viewer.ts';
import type { GeekityEnv } from '../env.ts';
import { THEME_ASSET_PREFIX } from './assets.ts';
import { representationOf } from './errors.ts';
import { HEALTH_PATH } from './health.ts';
import { requestPath } from './routes.ts';

/**
 * What a client is told to wait when the operator named no return time: long
 * enough that a crawler backs off, short enough that a fediverse server's next
 * retry lands after a typical upgrade.
 */
const DEFAULT_RETRY_AFTER_SECONDS = 600;

/** Never stored: a cached 503 would outlive the maintenance it announced. */
const NO_STORE = 'no-store';

/**
 * A signed-in admin's view of the public site during maintenance is theirs
 * alone, so no shared cache may keep it and hand it to a stranger.
 */
const PRIVATE_NO_STORE = 'private, no-store';

const STATIC_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Down for maintenance</title>
  </head>
  <body>
    <h1>Down for maintenance</h1>
    <p>This site is down for maintenance and will be back shortly. Please try again later.</p>
  </body>
</html>
`;

const MARKDOWN_BODY =
  '# Down for maintenance\n\nThis site is down for maintenance and will be back shortly. Please try again later.\n';

const JSON_BODY = `${JSON.stringify(
  {
    error: 'maintenance',
    message: 'This site is down for maintenance and will be back shortly. Try again later.',
  },
  undefined,
  2,
)}\n`;

/**
 * Paths that answer as usual during maintenance: the health checks, so an
 * orchestrator can tell a site that is down on purpose from a broken one; the
 * admin, login page included, so an admin can sign in and work; and the
 * theme's files, so the maintenance page is drawn in the site's own style.
 */
function isExempt(pathname: string): boolean {
  return (
    pathname === HEALTH_PATH ||
    pathname === '/_geekity/health' ||
    pathname === ADMIN_PREFIX ||
    pathname.startsWith(`${ADMIN_PREFIX}/`) ||
    pathname.startsWith(THEME_ASSET_PREFIX)
  );
}

/**
 * Turn the site away while it is in maintenance mode (TASK-130).
 *
 * Everything that is not exempt answers 503 with `Retry-After`, so browsers,
 * crawlers and fediverse servers all read the outage as temporary: a crawler
 * keeps the page in its index, and a server whose inbox delivery was refused
 * queues it for a retry rather than dropping it. Mounted in front of the
 * federation middleware, so no inbox, Fedify's or the WordPress plugin's, is
 * reached at all.
 *
 * A signed-in user browses the public site as usual, which is how an admin
 * checks an upgrade before turning maintenance off. The test is the one the
 * comment form applies: a live session naming a user who still exists.
 */
export const maintenanceGate: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  const window = c.var.maintenance();
  const pathname = requestPath(c);
  if (window === undefined || isExempt(pathname)) return await next();

  if (signedInCommenter(c) !== undefined) {
    await next();
    c.res.headers.set('cache-control', PRIVATE_NO_STORE);
    return;
  }

  return unavailable(c, pathname, window.until);
};

function unavailable(c: Context<GeekityEnv>, pathname: string, until: Date | undefined): Response {
  const upcoming = until !== undefined && until > c.var.config.now() ? until : undefined;
  const headers = {
    'retry-after': upcoming?.toUTCString() ?? String(DEFAULT_RETRY_AFTER_SECONDS),
    'cache-control': NO_STORE,
  };

  switch (representationOf(pathname, c.req.header('accept'))) {
    case 'json':
      return c.body(JSON_BODY, 503, {
        ...headers,
        'content-type': 'application/json; charset=utf-8',
      });
    case 'markdown':
      return c.body(MARKDOWN_BODY, 503, {
        ...headers,
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': 'inline',
      });
    case 'html':
      return c.html(page(c, pathname, upcoming), 503, headers);
  }
}

function page(c: Context<GeekityEnv>, pathname: string, until: Date | undefined): string {
  try {
    return c.var.renderer.renderMaintenance(pathname, until);
  } catch (error) {
    console.error('The maintenance page could not be rendered:', error);
    return STATIC_PAGE;
  }
}
