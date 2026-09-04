import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { Environment } from 'nunjucks';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../env.ts';
import { adminAssetResponse, ADMIN_ASSET_PREFIX } from './assets.ts';
import { credentialProblem } from './credentials.ts';
import { editorPath, mountDocumentScreens, PAGE_KIND, POST_KIND } from './documents.ts';
import { FEDERATION_PATH, mountFederationScreen } from './federation.ts';
import { takeFlash } from './flash.ts';
import { adminSecurityHeaders } from './headers.ts';
import { mountPreview } from './preview.ts';
import { AVATAR_PATH, mountSettings } from './settings.ts';
import {
  ADMIN_PREFIX,
  clearSessionCookie,
  CSRF_FIELD,
  csrfTokenMatches,
  sessionIdFrom,
  setSessionCookie,
} from './session.ts';
import { DuplicateUsernameError } from './store.ts';
import type { Session, User } from './store.ts';
import { CATEGORY_KIND, mountTaxonomyScreens, TAG_KIND, TAXONOMY_KINDS } from './taxonomy.ts';
import { ADMIN_TEMPLATES, createAdminTemplateEnvironment } from './templates.ts';
import { clientAddress, createLoginThrottle, describeWait, loginKeys } from './throttle.ts';
import type { LoginThrottle } from './throttle.ts';
import { mountUploads, refuseOversizedUpload, UPLOADS_PATH } from './uploads.ts';
import { mountUsers } from './users.ts';

/** Where the login form lives. */
export const LOGIN_PATH = `${ADMIN_PREFIX}/login`;
/** Where the first-run form lives. */
export const SETUP_PATH = `${ADMIN_PREFIX}/setup`;
/** Where the logout form posts. */
export const LOGOUT_PATH = `${ADMIN_PREFIX}/logout`;
/** One entry in the admin's left-hand navigation. */
export interface AdminSection {
  /** The name a screen passes as `section` to mark itself current. */
  section: string;
  /** What the link says. */
  label: string;
  /** Where it goes. */
  url: string;
}

/**
 * The sections of the admin, in the order doc-5 lists them.
 *
 * Every screen renders the same list and marks one of them, so a screen added
 * later only has to name its section. The screens behind most of these links
 * are still placeholders; the navigation is the shape of the whole admin, not
 * of the part that is built.
 */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { section: 'dashboard', label: 'Dashboard', url: ADMIN_PREFIX },
  { section: 'posts', label: 'Posts', url: `${ADMIN_PREFIX}/posts` },
  { section: 'pages', label: 'Pages', url: `${ADMIN_PREFIX}/pages` },
  { section: TAG_KIND.section, label: TAG_KIND.plural, url: TAG_KIND.basePath },
  { section: CATEGORY_KIND.section, label: CATEGORY_KIND.plural, url: CATEGORY_KIND.basePath },
  { section: 'settings', label: 'Settings', url: `${ADMIN_PREFIX}/settings` },
  { section: 'users', label: 'Users', url: `${ADMIN_PREFIX}/users` },
  { section: 'federation', label: 'Federation', url: `${ADMIN_PREFIX}/federation` },
];

/** How many recent posts the dashboard lists. */
export const DASHBOARD_RECENT_POSTS = 5;

/** Where the editor for a post lives. */
export function postEditorPath(slug: string): string {
  return editorPath(POST_KIND, slug);
}

/**
 * Register the admin on a Hono app.
 *
 * Everything under `/admin` goes through one guard, registered as middleware
 * rather than per route, so a path with no handler of its own — `/admin/posts`
 * before TASK-11 builds it — still redirects an anonymous visitor to the login
 * form instead of falling through to the public site's 404.
 *
 * The guard decides three things, in order: whether the site has any users at
 * all (none means every admin URL is the setup form), whether the request
 * carries a live session, and, for anything but a GET, whether it carries this
 * session's CSRF token.
 */
export function mountAdmin(app: Hono<GeekityEnv>): void {
  // Built on the first request, because the config that says whether to cache
  // templates is only on the context.
  let environment: Environment | undefined;

  function templates(c: Context<GeekityEnv>): Environment {
    environment ??= createAdminTemplateEnvironment({ noCache: c.var.config.watch });
    return environment;
  }

  // One throttle for the whole mount, built on the first failed sign-in for
  // the same reason: the limits and the clock are on the context. It holds
  // nothing but recent failures, so it belongs to the process rather than to
  // the database — a restart clears it, which is the right trade for state an
  // anonymous caller can create.
  let throttled: LoginThrottle | undefined;

  function loginThrottle(config: ResolvedConfig): LoginThrottle {
    throttled ??= createLoginThrottle({
      attempts: config.loginAttempts,
      lockoutSeconds: config.loginLockout,
      now: config.now,
    });
    return throttled;
  }

  /**
   * Render one admin template.
   *
   * Everything the chrome needs — who is signed in, the navigation, the CSRF
   * token, the queued flash messages — is put in the context here rather than
   * by each handler, so a new screen is a template and a `section` name.
   * Reading the flash is what clears it, so it shows on exactly this page.
   */
  function render(
    c: Context<GeekityEnv>,
    template: string,
    context: Record<string, unknown> = {},
  ): Response {
    const session = c.var.session;
    const userId = session?.userId ?? null;

    const html = templates(c).render(template, {
      site: c.var.renderer.site(),
      adminUrl: ADMIN_PREFIX,
      siteUrl: '/',
      assetPrefix: ADMIN_ASSET_PREFIX,
      navigation: ADMIN_SECTIONS,
      logoutUrl: LOGOUT_PATH,
      csrfToken: session?.csrfToken ?? '',
      cspNonce: c.var.cspNonce ?? '',
      user: userId === null ? undefined : c.var.admin.getUserById(userId),
      flash: takeFlash(c),
      ...context,
    });
    return c.html(html);
  }

  // In front of everything, including the static files and the login form, so
  // "every admin response" means every one of them rather than every one a
  // handler happened to reach. It also mints the CSP nonce the editor's script
  // tag carries, which is why it has to run before any template is rendered.
  app.use(ADMIN_PREFIX, adminSecurityHeaders);
  app.use(`${ADMIN_PREFIX}/*`, adminSecurityHeaders);

  // Registered before the guard, so the login page can load its stylesheet
  // while nobody is logged in. Nothing under it is secret.
  app.get(`${ADMIN_ASSET_PREFIX}*`, (c) => {
    const pathname = new URL(c.req.url).pathname.slice(ADMIN_ASSET_PREFIX.length);
    const response = adminAssetResponse(decodePath(pathname), c.req.header('if-none-match'));
    return response ?? c.notFound();
  });

  // In front of the guard, because the guard parses the form to find the CSRF
  // token and parsing a multipart form reads the whole file into memory. Both
  // multipart endpoints need it: the editor's uploads and the avatar's.
  app.use(UPLOADS_PATH, refuseOversizedUpload);
  app.use(AVATAR_PATH, refuseOversizedUpload);

  app.use(ADMIN_PREFIX, guard);
  app.use(`${ADMIN_PREFIX}/*`, guard);

  app.get(SETUP_PATH, (c) => {
    anonymousSession(c);
    return render(c, ADMIN_TEMPLATES.setup, { setupUrl: SETUP_PATH, username: '' });
  });

  app.post(SETUP_PATH, async (c) => {
    const body = await c.req.parseBody();
    const username = text(body[USERNAME_FIELD]).trim();
    const password = text(body[PASSWORD_FIELD]);
    const confirmation = text(body['password_confirmation']);

    const problem = setupProblem(username, password, confirmation);
    if (problem !== undefined) return refuseSetup(c, username, problem);

    let user: User;
    try {
      user = c.var.admin.createUser({ username, password });
    } catch (error) {
      if (error instanceof DuplicateUsernameError) {
        return refuseSetup(c, username, error.message);
      }
      throw error;
    }

    // The first admin is logged straight in; making an account and then being
    // shown a login form would be a pointless second step.
    return logIn(c, user);
  });

  app.get(LOGIN_PATH, (c) => {
    anonymousSession(c);
    return render(c, ADMIN_TEMPLATES.login, { loginUrl: LOGIN_PATH, username: '' });
  });

  app.post(LOGIN_PATH, async (c) => {
    const config = c.var.config;
    const body = await c.req.parseBody();
    const username = text(body[USERNAME_FIELD]).trim();
    const password = text(body[PASSWORD_FIELD]);

    const address = clientAddress(c, config);
    const keys = loginKeys(username, address);

    // Checked before the password is verified, so a lockout refuses the right
    // password too. An attacker who found the password on the last allowed
    // guess would otherwise be let straight in.
    const throttle = loginThrottle(config);
    const wait = throttle.retryAfter(keys);
    if (wait !== undefined) {
      console.warn(
        `Refused a sign-in for ${JSON.stringify(username)} from ${address ?? 'an unknown address'}: locked out for another ${wait}s`,
      );
      anonymousSession(c);
      c.status(429);
      c.header('Retry-After', String(wait));
      return render(c, ADMIN_TEMPLATES.login, {
        loginUrl: LOGIN_PATH,
        username,
        // Says nothing about whether that username exists: an unknown one is
        // counted and locked out exactly as a real one is.
        error: `Too many sign-in attempts. Try again in ${describeWait(wait)}.`,
      });
    }

    const user = c.var.admin.verifyPassword(username, password);
    if (user === undefined) {
      throttle.fail(keys);
      console.warn(
        `Failed sign-in for ${JSON.stringify(username)} from ${address ?? 'an unknown address'}`,
      );
      // One message for both failures, so the form cannot be used to find out
      // which usernames exist.
      anonymousSession(c);
      c.status(401);
      return render(c, ADMIN_TEMPLATES.login, {
        loginUrl: LOGIN_PATH,
        username,
        error: 'That username and password do not match.',
      });
    }

    throttle.succeed(keys);
    return logIn(c, user);
  });

  app.post(LOGOUT_PATH, (c) => {
    const session = c.var.session;
    if (session !== undefined) c.var.admin.deleteSession(session.id);
    clearSessionCookie(c, c.var.config);
    return c.redirect(LOGIN_PATH, 303);
  });

  app.get(ADMIN_PREFIX, (c) => {
    const store = c.var.store;
    return render(c, ADMIN_TEMPLATES.dashboard, {
      section: 'dashboard',
      counts: store.counts(),
      recent: store.listAll({ type: 'post', limit: DASHBOARD_RECENT_POSTS }).map((document) => ({
        title: document.title,
        slug: document.slug,
        date: document.date,
        draft: document.draft,
        editUrl: postEditorPath(document.slug),
      })),
      // The one number on the dashboard that is not about the content
      // directory: it is what says whether publishing is reaching anybody.
      followers: c.var.admin.countFollowers(),
      federationUrl: FEDERATION_PATH,
    });
  });

  // The listing and the editor. Posts and pages are the same screens over the
  // same store; the kind decides what a file is called and which fields the
  // form has.
  mountDocumentScreens(app, { kind: POST_KIND, render });
  mountDocumentScreens(app, { kind: PAGE_KIND, render });

  // The terms themselves: what is in use, and the three things — rename,
  // merge, delete — that rewrite every file carrying one.
  for (const kind of TAXONOMY_KINDS) mountTaxonomyScreens(app, { kind, render });

  // The two endpoints the editor talks to rather than navigates to. Both are
  // inside the guard, so both need the session's CSRF token like every other
  // POST in the admin.
  mountPreview(app);
  mountUploads(app);

  // The site's own settings: SQLite is the source, content/_data/site.json is
  // the mirror an Eleventy build of the same content reads.
  mountSettings(app, { render });

  // Who may sign in: the list, the add form, and the change-password form for
  // whoever is looking at it.
  mountUsers(app, { render });

  // The fediverse side: the actor, the followers, the inbox log, and what the
  // site sent to whom.
  mountFederationScreen(app, { render });

  const built = new Set([
    POST_KIND.section,
    PAGE_KIND.section,
    TAG_KIND.section,
    CATEGORY_KIND.section,
    'dashboard',
    'settings',
    'users',
    'federation',
  ]);

  // The sections doc-5 lists but no task has built yet. They are registered so
  // the navigation goes somewhere: a link that 404s reads as a broken admin,
  // and the guard already keeps strangers out of all of them.
  for (const item of ADMIN_SECTIONS) {
    if (built.has(item.section)) continue;
    app.get(item.url, (c) =>
      render(c, ADMIN_TEMPLATES.placeholder, { section: item.section, heading: item.label }),
    );
  }

  // `/admin/` is the same screen as `/admin`, and only one of them is the URL.
  app.get(`${ADMIN_PREFIX}/`, (c) => c.redirect(ADMIN_PREFIX, 301));

  /** The session to hang a CSRF token on, made on the spot if there is none. */
  function anonymousSession(c: Context<GeekityEnv>): Session {
    const existing = c.var.session;
    if (existing !== undefined) return existing;

    const session = c.var.admin.createSession({
      userId: null,
      lifetimeSeconds: c.var.config.sessionLifetime,
    });
    setSessionCookie(c, session.id, { config: c.var.config, expiresAt: session.expiresAt });
    c.set('session', session);
    return session;
  }

  /** Re-render the setup form with a message, and the status a bad form gets. */
  function refuseSetup(c: Context<GeekityEnv>, username: string, error: string): Response {
    anonymousSession(c);
    c.status(400);
    return render(c, ADMIN_TEMPLATES.setup, { setupUrl: SETUP_PATH, username, error });
  }

  /**
   * Start an authenticated session and send the browser to the dashboard.
   *
   * The session the request arrived with is deleted rather than promoted, so a
   * session id an attacker planted before login is not the id that ends up
   * logged in.
   */
  function logIn(c: Context<GeekityEnv>, user: User): Response {
    const admin = c.var.admin;
    const previous = c.var.session;
    if (previous !== undefined) admin.deleteSession(previous.id);
    // Logging in is rare and cheap; it is a good moment to sweep the table.
    admin.pruneSessions();

    const session = admin.createSession({
      userId: user.id,
      lifetimeSeconds: c.var.config.sessionLifetime,
    });
    setSessionCookie(c, session.id, { config: c.var.config, expiresAt: session.expiresAt });
    c.set('session', session);
    return c.redirect(ADMIN_PREFIX, 303);
  }
}

const USERNAME_FIELD = 'username';
const PASSWORD_FIELD = 'password';

/**
 * The one gate in front of every admin URL.
 *
 * It is exported so a site that mounts its own admin routes can put them
 * behind the same guard, and so the ordering is testable.
 */
export const guard: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  const admin = c.var.admin;
  const pathname = new URL(c.req.url).pathname;

  // Reading a session prunes it when it has expired, so an expired session is
  // gone from here on, not merely ignored.
  const sessionId = sessionIdFrom(c);
  const session = sessionId === undefined ? undefined : admin.getSession(sessionId);
  c.set('session', session);

  const isSetup = pathname === SETUP_PATH;
  const isLogin = pathname === LOGIN_PATH;

  if (admin.countUsers() === 0) {
    // Nobody can log in yet, so there is exactly one thing to do here.
    if (!isSetup) return c.redirect(SETUP_PATH, 302);
  } else {
    // Setup is over. Offering the form again would be an open door.
    if (isSetup) return c.redirect(session?.userId == null ? LOGIN_PATH : ADMIN_PREFIX, 302);
    if (!isLogin && (session === undefined || session.userId === null)) {
      return c.redirect(LOGIN_PATH, 302);
    }
  }

  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    if (session === undefined || !csrfTokenMatches(session.csrfToken, await submittedToken(c))) {
      return c.text('That form was stale or came from somewhere else. Reload and try again.', 403);
    }
  }

  await next();
};

/** The CSRF token in the request body, if the body is a form at all. */
async function submittedToken(c: Context<GeekityEnv>): Promise<unknown> {
  const contentType = c.req.header('content-type') ?? '';
  if (
    !contentType.includes('application/x-www-form-urlencoded') &&
    !contentType.includes('multipart/form-data')
  ) {
    return undefined;
  }
  // Hono caches the parsed form, so the handler behind this parses nothing twice.
  const body = await c.req.parseBody();
  return body[CSRF_FIELD];
}

/**
 * A percent-decoded request path. A path that will not decode is handed on as
 * it arrived, where it will match no file and become a 404.
 */
function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** What is wrong with a proposed first admin, or `undefined` when nothing is. */
function setupProblem(
  username: string,
  password: string,
  confirmation: string,
): string | undefined {
  // The same rules `geekity user add` enforces, so an account made either way
  // is an account the other door would have accepted.
  const problem = credentialProblem(username, password);
  if (problem !== undefined) return problem;
  if (password !== confirmation) return 'The two passwords do not match.';
  return undefined;
}
