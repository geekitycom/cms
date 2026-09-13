import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { Environment } from 'nunjucks';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../env.ts';
import {
  countUsers,
  createUser,
  DuplicateUsernameError,
  findUserById,
  verifyUserPassword,
} from './accounts.ts';
import type { User } from './accounts.ts';
import { mountAppearanceScreen } from './appearance.ts';
import { adminAssetResponse, ADMIN_ASSET_PREFIX } from './assets.ts';
import { credentialProblem } from './credentials.ts';
import { editorPath, mountDocumentScreens, PAGE_KIND, POST_KIND } from './documents.ts';
import { FEDERATION_PATH, mountFederationScreen } from './federation.ts';
import { takeFlash } from './flash.ts';
import { adminSecurityHeaders } from './headers.ts';
import { COMMENTS_PATH, mountCommentsScreen, pendingComments } from './comments.ts';
import { MEDIA_UPLOAD_PATH, mountMediaScreen } from './media.ts';
import { adminMenu } from './menu.ts';
import { MESSAGES_PATH, mountMessagesScreen, unreadMessages } from './messages.ts';
import { mountPreview } from './preview.ts';
import { FORGOT_PATH, mountRecovery, RESET_PATH } from './recovery.ts';
import { mountSettings } from './settings-pages.ts';
import {
  ADMIN_PREFIX,
  clearSessionCookie,
  CSRF_FIELD,
  csrfTokenMatches,
  sessionIdFrom,
  setSessionCookie,
} from './session.ts';
import type { AdminStore, Session } from './store.ts';
import { mountTaxonomyScreens, TAXONOMY_KINDS } from './taxonomy.ts';
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

  // A second throttle, on the same machinery and the same limits, for the
  // forgot-password form (TASK-54). Deliberately not the login one: sharing it
  // would let a stranger lock somebody out of signing in by asking for their
  // password to be reset over and over, which would turn the recovery feature
  // into a weapon against the person it exists for.
  let recoveryThrottled: LoginThrottle | undefined;

  function recoveryThrottle(config: ResolvedConfig): LoginThrottle {
    recoveryThrottled ??= createLoginThrottle({
      attempts: config.loginAttempts,
      lockoutSeconds: config.loginLockout,
      now: config.now,
    });
    return recoveryThrottled;
  }

  /**
   * Render one admin template.
   *
   * Everything the chrome needs — who is signed in, the navigation, the CSRF
   * token, the queued flash messages — is put in the context here rather than
   * by each handler, so a new screen is a template and the pair of names that
   * says where it is in the menu: its `section` and its `child`. A pair the
   * registry does not hold throws rather than rendering a menu expanded around
   * nothing. Reading the flash is what clears it, so it shows on exactly this
   * page.
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
      navigation: adminMenu({ section: name(context['section']), child: name(context['child']) }),
      logoutUrl: LOGOUT_PATH,
      csrfToken: session?.csrfToken ?? '',
      cspNonce: c.var.cspNonce ?? '',
      user: userId === null ? undefined : findUserById(c.var.config.dataDir, userId),
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
  // token and parsing a multipart form reads the whole file into memory. Every
  // multipart endpoint needs it: the editor's uploads and the media screen's
  // own form.
  app.use(UPLOADS_PATH, refuseOversizedUpload);
  app.use(MEDIA_UPLOAD_PATH, refuseOversizedUpload);

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
      user = await createUser({ dataDir: c.var.config.dataDir, username, password });
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
    return render(c, ADMIN_TEMPLATES.login, {
      loginUrl: LOGIN_PATH,
      forgotUrl: FORGOT_PATH,
      username: '',
    });
  });

  // Forgetting a password. Registered beside the login form, and named in the
  // guard below, because both of its screens are reached by somebody who by
  // definition cannot sign in.
  mountRecovery(app, { render, anonymousSession, throttle: recoveryThrottle });

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
        forgotUrl: FORGOT_PATH,
        username,
        // Says nothing about whether that username exists: an unknown one is
        // counted and locked out exactly as a real one is.
        error: `Too many sign-in attempts. Try again in ${describeWait(wait)}.`,
      });
    }

    const user = verifyUserPassword(c.var.config.dataDir, username, password);
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
        forgotUrl: FORGOT_PATH,
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
      child: 'home',
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
      // The other number that is not about the content directory: with no
      // email in this milestone, the dashboard is how a moderator finds out
      // that somebody is waiting (TASK-50).
      pendingComments: pendingComments(c.var.admin),
      commentsUrl: COMMENTS_PATH,
      // And what the contact form has left waiting, which is the same kind of
      // number for the same reason (TASK-56).
      unreadMessages: unreadMessages(c.var.config.dataDir),
      messagesUrl: MESSAGES_PATH,
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

  // Everything under content/uploads: what is there, what links to it, and
  // the upload form that stores a file by the same rules the editor does.
  mountMediaScreen(app, { render });

  // What the contact form on a page has collected, and the two things that can
  // be done about one: mark it read, and delete it.
  mountMessagesScreen(app, { render });

  // What people have left on the site, and the four things that can be done
  // about it: approve, spam, delete, reply.
  mountCommentsScreen(app, { render });

  // What the site is wearing: the themes on disk, and the one setting that
  // says which of them (decision-15).
  mountAppearanceScreen(app, { render });

  // The site's own settings, which are content/_data/site.json itself: the
  // screen reads that file and writes it back (decision-9).
  mountSettings(app, { render });

  // Who may sign in: the list, the add form, and the change-password form for
  // whoever is looking at it.
  mountUsers(app, { render });

  // The fediverse side: the actor, the followers, the inbox log, and what the
  // site sent to whom.
  mountFederationScreen(app, { render });

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
  const dataDir = c.var.config.dataDir;
  const pathname = new URL(c.req.url).pathname;

  // Reading a session prunes it when it has expired, so an expired session is
  // gone from here on, not merely ignored.
  const sessionId = sessionIdFrom(c);
  const session = liveSession(
    admin,
    dataDir,
    sessionId === undefined ? undefined : admin.getSession(sessionId),
  );
  c.set('session', session);

  const isSetup = pathname === SETUP_PATH;
  // The three screens somebody with no login is allowed to reach: the login
  // form, and the two halves of forgetting a password (TASK-54). Everything
  // else under /admin redirects an anonymous visitor to the login form.
  const isAnonymous =
    pathname === LOGIN_PATH || pathname === FORGOT_PATH || pathname === RESET_PATH;

  if (countUsers(dataDir) === 0) {
    // Nobody can log in yet, so there is exactly one thing to do here.
    if (!isSetup) return c.redirect(SETUP_PATH, 302);
  } else {
    // Setup is over. Offering the form again would be an open door.
    if (isSetup) return c.redirect(session?.userId == null ? LOGIN_PATH : ADMIN_PREFIX, 302);
    if (!isAnonymous && (session === undefined || session.userId === null)) {
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

/**
 * The session a request really has: one whose user is still in `users.json`.
 *
 * `sessions.user_id` used to be a foreign key into the users table, so a user
 * who was deleted took their logins with them and a session could never name
 * somebody who was not there. The accounts are a file now and the sessions are
 * a cache in a database that may be deleted, restored or rebuilt on its own,
 * so the join is made here instead: a session naming a user the file does not
 * hold is deleted, and the request is anonymous. That is exactly what makes a
 * login survive a rebuilt database only as far as the file still holds the
 * person it was made for.
 */
function liveSession(
  admin: AdminStore,
  dataDir: string,
  session: Session | undefined,
): Session | undefined {
  if (session === undefined || session.userId === null) return session;
  if (findUserById(dataDir, session.userId) !== undefined) return session;

  admin.deleteSession(session.id);
  return undefined;
}

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

/** A `section` or a `child` off a render context, when the screen named one. */
function name(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
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
