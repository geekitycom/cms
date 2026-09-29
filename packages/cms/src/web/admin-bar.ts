import type { Context, MiddlewareHandler } from 'hono';
import type { Environment } from 'nunjucks';

import { editorPath, newEditorPath, PAGE_KIND, POST_KIND } from '../admin/documents.ts';
import type { DocumentKind } from '../admin/documents.ts';
import { LOGOUT_PATH } from '../admin/routes.ts';
import { ADMIN_PREFIX } from '../admin/session.ts';
import { ADMIN_TEMPLATES, createAdminTemplateEnvironment } from '../admin/templates.ts';
import { editUserPath } from '../admin/users.ts';
import { signedInAccount } from '../comments/viewer.ts';
import type { SignedInAccount } from '../comments/viewer.ts';
import type { DocumentType } from '../content/document.ts';
import type { GeekityEnv } from '../env.ts';
import { PRIVATE_CACHE_CONTROL } from './negotiate.ts';
import { requestPath } from './routes.ts';

/** The editor screens each kind of document is written in. */
const KINDS: Readonly<Record<DocumentType, DocumentKind>> = { post: POST_KIND, page: PAGE_KIND };

/** Built on the first signed-in page; the admin's own is closed over by its mount. */
let environment: Environment | undefined;

/**
 * The admin bar across the top of the public site, for a signed-in user
 * (TASK-183).
 *
 * Where the public site's pages learn who is reading them. An anonymous request
 * goes through untouched, so what everybody else is sent, headers and bytes, is what
 * it was before the bar existed. For a signed-in one the account is put on the
 * context for the handlers, and whatever HTML they answer with, a document, a
 * listing, a search, the 404 or the 500, gets the bar straight after its
 * `<body>` tag and the headers of a page drawn for one reader: private,
 * no-store, and no validator. Anything that is not HTML, the JSON, the
 * Markdown, the feeds, ActivityPub, is left exactly as it was.
 *
 * Not inside `/admin`, which has a bar of its own and a CSP that would refuse
 * this one's inline stylesheet.
 */
export const publicAdminBar: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  const pathname = requestPath(c);
  if (pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`)) return await next();

  const account = signedInAccount(c);
  if (account === undefined) return await next();

  c.set('signedIn', account);
  await next();

  if (!(c.res.headers.get('content-type') ?? '').startsWith('text/html')) return;

  const headers = new Headers(c.res.headers);
  headers.set('cache-control', PRIVATE_CACHE_CONTROL);
  headers.delete('etag');
  headers.delete('last-modified');
  headers.delete('content-length');

  const { status } = c.res;
  const body = withBar(await c.res.text(), renderBar(c, account));
  // Cleared first, because assigning over a response copies its headers onto
  // the new one, and the validators being dropped would come straight back.
  c.res = undefined;
  c.res = new Response(body, { status, headers });
};

/** The bar's markup for this reader and this page. */
function renderBar(c: Context<GeekityEnv>, account: SignedInAccount): string {
  environment ??= createAdminTemplateEnvironment({ noCache: c.var.config.watch });
  const { user } = account;
  const shown = c.var.shownDocument;

  return environment
    .render(ADMIN_TEMPLATES.publicAdminBar, {
      site: c.var.renderer.site(),
      adminUrl: ADMIN_PREFIX,
      barLinks: [
        { label: '+ New', url: newEditorPath(POST_KIND) },
        ...(shown === undefined
          ? []
          : [
              {
                label: `Edit ${capitalized(KINDS[shown.type].singular)}`,
                url: editorPath(KINDS[shown.type], shown.slug),
              },
            ]),
      ],
      me: { name: user.profile?.displayName ?? user.username, url: editUserPath(user.id) },
      logoutUrl: LOGOUT_PATH,
      csrfToken: account.csrfToken,
    })
    .trim();
}

/**
 * `html` with `bar` straight after its opening `<body>` tag, or unchanged when
 * it has none to put it after.
 */
function withBar(html: string, bar: string): string {
  const body = /<body\b[^>]*>/i.exec(html);
  if (body === null) return html;
  const at = body.index + body[0].length;
  return `${html.slice(0, at)}${bar}${html.slice(at)}`;
}

function capitalized(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}
