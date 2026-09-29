import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Environment } from 'nunjucks';

import { ADMIN_ASSET_PREFIX } from '../admin/assets.ts';
import { ADMIN_PREFIX } from '../admin/session.ts';
import { ADMIN_TEMPLATES, createAdminTemplateEnvironment } from '../admin/templates.ts';
import type { GeekityEnv } from '../env.ts';
import {
  DOCUMENT_REPRESENTATIONS,
  selectRepresentation,
  splitRepresentationExtension,
} from './negotiate.ts';
import type { Representation } from './negotiate.ts';
import { requestPath } from './routes.ts';

/**
 * A server error is never stored: the next request may well succeed, and a
 * cache that kept this one would go on serving the failure after it was fixed.
 */
const NO_STORE = 'no-store';

/**
 * The last resort, for when the page meant to explain the failure fails too.
 * Nothing in it can throw: no template, no site data, no theme.
 */
const STATIC_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Something went wrong</title>
  </head>
  <body>
    <h1>Something went wrong</h1>
    <p>This page could not be shown because of a problem on the server. Try again in a moment, or go <a href="/">home</a>.</p>
  </body>
</html>
`;

const MARKDOWN_BODY =
  '# Something went wrong\n\nThe server could not answer this request. Try again later, or go to the [home page](/).\n';

const JSON_BODY = `${JSON.stringify(
  {
    error: 'internal_server_error',
    message: 'Something went wrong on the server. Try again later.',
  },
  undefined,
  2,
)}\n`;

/** Built on the first admin failure; the admin's own is closed over by its mount. */
let adminEnvironment: Environment | undefined;

/**
 * What a request whose handler threw is answered with (TASK-129).
 *
 * The error goes to the operator's log with the request that caused it, and
 * the reader gets a 500 that says so in the admin's layout, the theme's, or
 * the representation they asked for, with nothing from the error in it. An
 * `HTTPException` is a response somebody chose on purpose and is passed
 * through as Hono's own handler would.
 */
export const serverError: ErrorHandler<GeekityEnv> = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();

  const pathname = requestPath(c);
  console.error(`${c.req.method} ${pathname} failed:`, error);

  if (pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`)) {
    return c.html(
      orStaticPage(() => {
        adminEnvironment ??= createAdminTemplateEnvironment();
        return adminEnvironment.render(ADMIN_TEMPLATES.serverError, {
          adminUrl: ADMIN_PREFIX,
          assetPrefix: ADMIN_ASSET_PREFIX,
        });
      }),
      500,
      { 'cache-control': NO_STORE },
    );
  }

  switch (representationOf(pathname, c.req.header('accept'))) {
    case 'json':
      return c.body(JSON_BODY, 500, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': NO_STORE,
      });
    case 'markdown':
      return c.body(MARKDOWN_BODY, 500, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': 'inline',
        'cache-control': NO_STORE,
      });
    case 'html':
      return c.html(
        orStaticPage(() => c.var.renderer.renderServerError(pathname)),
        500,
        { 'cache-control': NO_STORE },
      );
  }
};

/**
 * The representation the failed request was after: the one its `.md` or
 * `.json` suffix names, else the one its `Accept` header prefers, else HTML.
 */
export function representationOf(pathname: string, accept: string | undefined): Representation {
  return (
    splitRepresentationExtension(pathname)?.representation ??
    selectRepresentation(accept, DOCUMENT_REPRESENTATIONS) ??
    'html'
  );
}

function orStaticPage(render: () => string): string {
  try {
    return render();
  } catch (error) {
    console.error('The 500 page could not be rendered either:', error);
    return STATIC_PAGE;
  }
}
