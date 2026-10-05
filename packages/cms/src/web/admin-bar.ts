import type { Context, MiddlewareHandler } from 'hono';
import type { Environment } from 'nunjucks';

import { adminColorScheme } from '../admin/admin-theme.ts';
import { ADMIN_ASSET_PREFIX } from '../admin/assets.ts';
import { editorPath, newEditorPath, PAGE_KIND, POST_KIND } from '../admin/documents.ts';
import type { DocumentKind } from '../admin/documents.ts';
import { LOGOUT_PATH } from '../admin/routes.ts';
import { ADMIN_PREFIX } from '../admin/session.ts';
import { ADMIN_TEMPLATES, createAdminTemplateEnvironment } from '../admin/templates.ts';
import { editUserPath } from '../admin/users.ts';
import { signedInAccount } from '../comments/viewer.ts';
import type { SignedInAccount } from '../comments/viewer.ts';
import type { Document, DocumentType } from '../content/document.ts';
import type { GeekityEnv } from '../env.ts';
import { siteLocale, siteTimezone } from './context.ts';
import { hiddenReason } from './documents.ts';
import type { HiddenReason } from './documents.ts';
import { PRIVATE_CACHE_CONTROL } from './negotiate.ts';
import { requestPath } from './routes.ts';
import { formatDate } from './templates.ts';

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
 * `<body>` tag, the `geekity-admin-bar` class on `<html>`, and the headers of
 * a page drawn for one reader: private, no-store, and no validator. Anything
 * that is not HTML, the JSON, the Markdown, the feeds, ActivityPub, is left
 * exactly as it was.
 *
 * Not inside `/admin`, which has a bar of its own and a CSP that would refuse
 * this one's inline stylesheet. Not on a response marked `frameable` either:
 * the embed view (TASK-208) is put in other sites' pages, so it must look the
 * same whoever's browser fetched it, and carry no session's CSRF token.
 */
export const publicAdminBar: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  const pathname = requestPath(c);
  if (pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`)) return await next();

  const account = signedInAccount(c);
  if (account === undefined) return await next();

  c.set('signedIn', account);
  await next();

  if (c.var.frameable === true) return;
  if (!(c.res.headers.get('content-type') ?? '').startsWith('text/html')) return;

  const headers = new Headers(c.res.headers);
  headers.set('cache-control', PRIVATE_CACHE_CONTROL);
  headers.delete('etag');
  headers.delete('last-modified');
  headers.delete('content-length');

  const { status } = c.res;
  const body = withAdminBar(withoutSpeculationRules(await c.res.text()), renderBar(c, account));
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
      siteHref: '/',
      barLinks: [
        { label: 'View admin', url: ADMIN_PREFIX },
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
      barScheme: adminColorScheme(user.adminTheme),
      assetPrefix: ADMIN_ASSET_PREFIX,
      logoutUrl: LOGOUT_PATH,
      csrfToken: account.csrfToken,
      notice: shown === undefined ? undefined : unpublishedNotice(c, shown),
    })
    .trim();
}

function unpublishedNotice(c: Context<GeekityEnv>, document: Document): string | undefined {
  const reason = hiddenReason(document, c.var.store.now());
  if (reason === undefined) return undefined;
  return `${hiddenBecause(c, document, reason)}, so it is not published. Only signed-in users can see it.`;
}

function hiddenBecause(c: Context<GeekityEnv>, document: Document, reason: HiddenReason): string {
  const it = `This ${document.type}`;
  switch (reason.kind) {
    case 'trashed':
      return `${it} is in the trash`;
    case 'draft':
      return `${it} is a draft`;
    case 'scheduled': {
      const site = c.var.renderer.site();
      return `${it} is scheduled for ${formatDate(reason.at, 'long', siteTimezone(site), siteLocale(site))}`;
    }
    case 'unrecognized-visibility':
      return `${it}’s visibility, “${reason.visibility}”, is not one the site recognizes`;
  }
}

/**
 * `html` with every `<script type="speculationrules">` taken out (TASK-140).
 *
 * A signed-in reader's pages are drawn for them alone and never stored, so a
 * prefetch is a second render nobody may see, and a speculative request that
 * carries a session is one the site would rather not be sent. Removed here
 * rather than left to each theme, so a theme's rules stay one static block and
 * the anonymous page keeps its bytes.
 */
function withoutSpeculationRules(html: string): string {
  return html.replace(
    /<script\b[^>]*\btype\s*=\s*(["']?)speculationrules\1[^>]*>[\s\S]*?<\/script\s*>/gi,
    '',
  );
}

/** The class on `<html>` of a page that carries the bar, for a theme to key off. */
const ROOT_CLASS = 'geekity-admin-bar';

/**
 * `html` with `bar` straight after its opening `<body>` tag and the root class
 * on `<html>`; unchanged when it has no `<body>` tag to put the bar after.
 */
function withAdminBar(html: string, bar: string): string {
  const body = /<body\b[^>]*>/i.exec(html);
  if (body === null) return html;
  const afterBody = body.index + body[0].length;
  return withRootClass(`${html.slice(0, afterBody)}${bar}${html.slice(afterBody)}`);
}

/** `html` with ROOT_CLASS added to its `<html>` tag's classes. */
function withRootClass(html: string): string {
  const tag = /<html\b[^>]*>/i.exec(html);
  if (tag === null) return html;
  const attribute = /(\sclass\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
  const classed = attribute.test(tag[0])
    ? tag[0].replace(
        attribute,
        (_match, lead: string, double?: string, single?: string, bare?: string) =>
          `${lead}"${ROOT_CLASS} ${(double ?? single ?? bare ?? '').replaceAll('"', '&quot;')}"`,
      )
    : tag[0].replace(/^<html\b/i, `<html class="${ROOT_CLASS}"`);
  return `${html.slice(0, tag.index)}${classed}${html.slice(tag.index + tag[0].length)}`;
}

function capitalized(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}
