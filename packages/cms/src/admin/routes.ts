import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { Environment } from 'nunjucks';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../web/env.ts';
import { mountAppActivity } from './app-activity.ts';
import { mountAutosave } from './autosave.ts';
import { mountConnectedApps } from './connected-apps.ts';
import { CONSENT_PATH, mountConsentScreen } from './indieauth-consent.ts';
import {
  countUsers,
  createUser,
  DuplicateUsernameError,
  findUserById,
  SetupClosedError,
  userIssuedTo,
  verifyUserPassword,
} from '../site/users.ts';
import type { User } from '../site/users.ts';
import { adminColorScheme } from '../site/admin-theme.ts';
import { mountAppearanceScreen } from './appearance.ts';
import { mountLookScreen } from './look.ts';
import { adminAssetResponse } from './assets.ts';
import {
  ADMIN_ASSET_PREFIX,
  ADMIN_PREFIX,
  editUserPath,
  LOGIN_PATH,
  returnPath,
} from '../site/admin-paths.ts';
import { credentialProblem, MAXIMUM_USERNAME_LENGTH } from './credentials.ts';
import {
  editorPath,
  mountDocumentScreens,
  newEditorPath,
  PAGE_SCREENS,
  POST_SCREENS,
  WIKI_SCREENS,
} from './documents.ts';
import { mountFederationScreen } from './federation.ts';
import { takeClearedAutosaves, takeFlash } from './flash.ts';
import { adminSecurityHeaders } from './headers.ts';
import { mountCommentsScreen } from './comments.ts';
import { MEDIA_UPLOAD_PATH, mountMediaScreen } from './media.ts';
import { adminMenu } from './menu.ts';
import { mountMessagesScreen } from './messages.ts';
import { mountNavigationScreen } from './navigation.ts';
import { mountPreview } from './preview.ts';
import { FORGOT_PATH, mountRecovery, RECOVERY_FIELDS, RESET_PATH } from './recovery.ts';
import { mountSettings } from './settings-pages.ts';
import { mountSyndicationTargetsScreen } from './syndication-targets.ts';
import {
  clearSessionCookie,
  CROSS_SITE_REFUSAL,
  crossSiteWrite,
  csrfTokenMatches,
  retireOldSessionCookie,
  sessionIdFrom,
  startSession,
} from '../web/session.ts';
import { CSRF_FIELD } from '../forms/protection.ts';
import type { AdminStore, Session } from '../store/admin-store.ts';
import { mountTaxonomyScreens, TAXONOMY_KINDS } from './taxonomy.ts';
import { ADMIN_TEMPLATES, createAdminTemplateEnvironment } from './templates.ts';
import { clientAddress, createSignInThrottle, describeWait } from '../web/throttle.ts';
import { mountToolsScreen } from './tools.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { DEV_MODE_PATH, mountDevModeScreen } from './dev-mode.ts';
import { mountExportScreen } from './export.ts';
import { mountMaintenanceScreen } from './maintenance.ts';
import { mountPersonalDataScreen } from './personal-data.ts';
import { mountEditorActions } from './editor-actions.ts';
import { mountItemLookup, mountItemSearch } from './item-lookup.ts';
import { mountPluginsScreen, pluginScreens } from './plugins.ts';
import type { SignInThrottle } from '../web/throttle.ts';
import { mountUploads, uploadBodyLimit, uploadTooLarge, UPLOADS_PATH } from './uploads.ts';
import { readWithin } from '../webmention/fetch-public.ts';
import { mountUsers } from './users.ts';
import { createConfirmPassword } from './confirm-password.ts';
import { mountWritingGoals } from './writing-goals.ts';
import { mountDashboard } from './dashboard.ts';

/** Where the first-run form lives. */
export const SETUP_PATH = `${ADMIN_PREFIX}/setup`;
/** Where the logout form posts. */
export const LOGOUT_PATH = `${ADMIN_PREFIX}/logout`;

/** Where the editor for a post lives. */
export function postEditorPath(slug: string): string {
  return editorPath(POST_SCREENS, slug);
}

/**
 * Register the admin on a Hono app.
 *
 * Everything under `/admin` goes through one guard, registered as middleware
 * rather than per route, so a path with no handler of its own still redirects
 * an anonymous visitor to the login form instead of falling through to the
 * public site's 404.
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
  let throttled: SignInThrottle | undefined;

  function loginThrottle(config: ResolvedConfig): SignInThrottle {
    throttled ??= createSignInThrottle({
      attempts: config.loginAttempts,
      lockoutSeconds: config.loginLockout,
      now: config.now,
    });
    return throttled;
  }

  const confirmPassword = createConfirmPassword(loginThrottle);

  // A second throttle, on the same machinery and the same limits, for the
  // forgot-password form. Deliberately not the login one: sharing it
  // would let a stranger lock somebody out of signing in by asking for their
  // password to be reset over and over, which would turn the recovery feature
  // into a weapon against the person it exists for.
  let recoveryThrottled: SignInThrottle | undefined;

  function recoveryThrottle(config: ResolvedConfig): SignInThrottle {
    recoveryThrottled ??= createSignInThrottle({
      attempts: config.loginAttempts,
      lockoutSeconds: config.loginLockout,
      now: config.now,
    });
    return recoveryThrottled;
  }

  /**
   * Render one admin template.
   *
   * Everything the chrome needs — who is signed in, the theme they draw the
   * admin in, the navigation, the CSRF token, the queued flash messages — is
   * put in the context here rather than by each handler, so a new screen is a
   * template and the pair of names that says where it is in the menu: its
   * `section` and its `child`. A pair the registry does not hold throws rather
   * than rendering a menu expanded around nothing. Reading the flash is what
   * clears it, so it shows on exactly this page.
   */
  function render(
    c: Context<GeekityEnv>,
    template: string,
    context: Record<string, unknown> = {},
  ): Response {
    const session = c.var.session;
    const userId = session?.userId ?? null;
    const user = userId === null ? undefined : findUserById(c.var.config.dataDir, userId);

    const html = templates(c).render(template, {
      site: c.var.renderer.site(),
      adminUrl: ADMIN_PREFIX,
      siteUrl: '/',
      newPostUrl: newEditorPath(POST_SCREENS),
      uploadsUrl: UPLOADS_PATH,
      navigation: adminMenu(
        { section: name(context['section']), child: name(context['child']) },
        pluginScreens(c),
      ),
      logoutUrl: LOGOUT_PATH,
      csrfToken: session?.csrfToken ?? '',
      cspNonce: c.var.cspNonce ?? '',
      me:
        user === undefined
          ? undefined
          : { name: user.profile?.displayName ?? user.username, url: editUserPath(user.id) },
      flash: takeFlash(c),
      clearedAutosaves: takeClearedAutosaves(c),
      devModeUrl: c.var.devMode ? DEV_MODE_PATH : undefined,
      dataTheme: ACCOUNT_TEMPLATES.has(template) ? undefined : user?.adminTheme,
      barScheme: adminColorScheme(user?.adminTheme),
      ...context,
    });
    return c.html(html);
  }

  // In front of everything, including the static files and the login form, so
  // "every admin response" means every one of them rather than every one a
  // handler happened to reach. It also mints the CSP nonce the editor's script
  // tag carries, which is why it has to run before any template is rendered.
  app.use(`${ADMIN_PREFIX}/*`, adminSecurityHeaders);

  // Registered before the guard, so the login page can load its stylesheet
  // while nobody is logged in. Nothing under it is secret.
  app.get(`${ADMIN_ASSET_PREFIX}*`, (c) => {
    const pathname = new URL(c.req.url).pathname.slice(ADMIN_ASSET_PREFIX.length);
    const response = adminAssetResponse(decodePath(pathname), c.req.raw.headers);
    return response ?? c.notFound();
  });

  app.use(`${ADMIN_PREFIX}/*`, guard);

  app.get(SETUP_PATH, (c) => {
    anonymousSession(c);
    return render(c, ADMIN_TEMPLATES.setup, { setupUrl: SETUP_PATH, username: '' });
  });

  app.post(SETUP_PATH, async (c) => {
    const body = await c.req.parseBody();
    const username = stringOrEmpty(body[USERNAME_FIELD]).trim();
    const password = stringOrEmpty(body[PASSWORD_FIELD]);
    const confirmation = stringOrEmpty(body['password_confirmation']);

    const problem = setupProblem(username, password, confirmation);
    if (problem !== undefined) return refuseSetup(c, username, problem);

    let user: User;
    try {
      user = await createUser({
        dataDir: c.var.config.dataDir,
        username,
        password,
        now: c.var.config.now(),
        onlyIfNoUsers: true,
      });
    } catch (error) {
      if (error instanceof DuplicateUsernameError) {
        return refuseSetup(c, username, error.message);
      }
      if (error instanceof SetupClosedError) return c.redirect(LOGIN_PATH, 303);
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
      returnTo: returnPath(c.req.query(RETURN_TO_FIELD)),
    });
  });

  // Forgetting a password. Registered beside the login form, and named in the
  // guard below, because both of its screens are reached by somebody who by
  // definition cannot sign in.
  mountRecovery(app, { render, anonymousSession, recoveryThrottle, loginThrottle });

  app.post(LOGIN_PATH, async (c) => {
    const config = c.var.config;
    const body = await c.req.parseBody();
    const username = stringOrEmpty(body[USERNAME_FIELD]).trim();
    const password = stringOrEmpty(body[PASSWORD_FIELD]);
    const returnTo = returnPath(body[RETURN_TO_FIELD]);

    const address = clientAddress(c, config);
    const keys = { identifier: username, address };
    const attempted = `${shortened(username)} from ${address === undefined ? 'an unknown address' : shortened(address)}`;
    const shown = username.length > MAXIMUM_USERNAME_LENGTH ? '' : username;

    // Checked before the password is verified, so a lockout refuses the right
    // password too. An attacker who found the password on the last allowed
    // guess would otherwise be let straight in.
    const throttle = loginThrottle(config);
    const wait = throttle.retryAfter(keys);
    if (wait !== undefined) {
      console.warn(`Refused a sign-in for ${attempted}: locked out for another ${wait}s`);
      anonymousSession(c);
      c.status(429);
      c.header('Retry-After', String(wait));
      return render(c, ADMIN_TEMPLATES.login, {
        loginUrl: LOGIN_PATH,
        forgotUrl: FORGOT_PATH,
        username: shown,
        returnTo,
        // Says nothing about whether that username exists: an unknown one is
        // counted and locked out exactly as a real one is.
        error: `Too many sign-in attempts. Try again in ${describeWait(wait)}.`,
      });
    }

    throttle.fail(keys);
    const user = await verifyUserPassword(c.var.config.dataDir, username, password);
    if (user === undefined) {
      console.warn(`Failed sign-in for ${attempted}`);
      // One message for both failures, so the form cannot be used to find out
      // which usernames exist.
      anonymousSession(c);
      c.status(401);
      return render(c, ADMIN_TEMPLATES.login, {
        loginUrl: LOGIN_PATH,
        forgotUrl: FORGOT_PATH,
        username: shown,
        returnTo,
        error: 'That username and password do not match.',
      });
    }

    throttle.succeed(keys);
    return logIn(c, user, returnTo);
  });

  app.post(LOGOUT_PATH, (c) => {
    const session = c.var.session;
    if (session !== undefined) c.var.admin.deleteSession(session.id);
    clearSessionCookie(c, c.var.config);
    // Only the cache: the `cookies` directive clears the whole registrable
    // domain, sibling sites included.
    c.header('Clear-Site-Data', CLEAR_ON_LOGOUT);
    return c.redirect(LOGIN_PATH, 303);
  });

  mountDashboard(app, { render });

  // The listing and the editor. Posts and pages are the same screens over the
  // same store; the kind decides what a file is called and which fields the
  // form has.
  mountDocumentScreens(app, { kind: POST_SCREENS, render });
  mountDocumentScreens(app, { kind: PAGE_SCREENS, render });
  mountDocumentScreens(app, { kind: WIKI_SCREENS, render });

  // The terms themselves: what is in use, and the three things — rename,
  // merge, delete — that rewrite every file carrying one.
  for (const kind of TAXONOMY_KINDS) mountTaxonomyScreens(app, { kind, render });

  // Where a post can be sent: content/_data/syndicationTargets.json itself,
  // read and written the way the settings are.
  mountSyndicationTargetsScreen(app, { render });

  mountPreview(app);
  mountUploads(app);
  mountAutosave(app);

  // Every menu the site holds, and which of them the active theme renders. A
  // section of its own rather than a settings page: a menu is content a site
  // arranges, and the shape of the screen comes from the theme.
  mountNavigationScreen(app, { render });

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
  // says which of them.
  mountAppearanceScreen(app, { render });
  mountLookScreen(app, { render });

  mountEditorActions(app);
  mountItemLookup(app);
  mountItemSearch(app);
  mountPluginsScreen(app, { render, confirmPassword });

  // The jobs a site runs rather than the things it sets: reading every file
  // back into the index, on a site that is serving.
  mountToolsScreen(app, { render });
  mountPersonalDataScreen(app, { render });
  mountMaintenanceScreen(app, { render });
  mountDevModeScreen(app, { render });
  mountExportScreen(app, { render, confirmPassword });

  // The site's own settings, which are content/_data/site.json itself: the
  // screen reads that file and writes it back.
  mountSettings(app, { render });

  // The apps that hold a token for whoever is signed in. Before the
  // users screens, whose `/admin/users/:id` answers anything else with a 404.
  mountConnectedApps(app, { render });
  // What apps sent to the IndieAuth and Micropub endpoints, before
  // the users screens for the same reason.
  mountAppActivity(app, { render });
  mountWritingGoals(app, { render });

  // Who may sign in: the list, the add form, and the change-password form for
  // whoever is looking at it.
  mountUsers(app, { render, confirmPassword });

  // The fediverse side: the actor, the followers, the inbox log, and what the
  // site sent to whom.
  mountFederationScreen(app, { render });

  // Where a person approves signing in to another site as this one.
  mountConsentScreen(app, { render });

  // `/admin/` is the same screen as `/admin`, and only one of them is the URL.
  app.get(`${ADMIN_PREFIX}/`, (c) => c.redirect(ADMIN_PREFIX, 301));

  /** The session to hang a CSRF token on, made on the spot if there is none. */
  function anonymousSession(c: Context<GeekityEnv>): Session {
    return c.var.session ?? startSession(c, undefined);
  }

  /** Re-render the setup form with a message, and the status a bad form gets. */
  function refuseSetup(c: Context<GeekityEnv>, username: string, error: string): Response {
    anonymousSession(c);
    c.status(400);
    return render(c, ADMIN_TEMPLATES.setup, { setupUrl: SETUP_PATH, username, error });
  }

  /**
   * Start an authenticated session and send the browser to the dashboard, or
   * back to the admin page the login was interrupting.
   *
   * The session the request arrived with is deleted rather than promoted, so a
   * session id an attacker planted before login is not the id that ends up
   * logged in.
   */
  function logIn(c: Context<GeekityEnv>, user: User, returnTo?: string): Response {
    const admin = c.var.admin;
    const previous = c.var.session;
    if (previous !== undefined) admin.deleteSession(previous.id);
    // Logging in is rare and cheap; it is a good moment to sweep the table.
    admin.pruneSessions();

    startSession(c, user);
    return c.redirect(returnTo ?? ADMIN_PREFIX, 303);
  }
}

/** Drawn without the signed-in user's theme. */
const ACCOUNT_TEMPLATES: ReadonlySet<string> = new Set([
  ADMIN_TEMPLATES.login,
  ADMIN_TEMPLATES.setup,
  ADMIN_TEMPLATES.forgot,
  ADMIN_TEMPLATES.reset,
]);

const USERNAME_FIELD = 'username';
const PASSWORD_FIELD = 'password';
/** Where to go once signed in, carried through the login form. */
const RETURN_TO_FIELD = 'return_to';

/**
 * Pages a login carries a return address for: the IndieAuth consent screen,
 * which somebody reaches signed out from another site and must come back to
 * with the request intact.
 */
const RETURNABLE_PATHS: ReadonlySet<string> = new Set([CONSENT_PATH]);

function shortened(text: string): string {
  const cut = text.slice(0, MAXIMUM_USERNAME_LENGTH);
  return JSON.stringify(cut) + (cut.length < text.length ? '…' : '');
}

const CLEAR_ON_LOGOUT = '"cache"';

/** What somebody signed in under the pre-`__Host-` cookie reads on the login form. */
const RENAMED_COOKIE_NOTICE =
  'The sign-in cookie was renamed to make it harder to tamper with, so you have been signed out. Please sign in again.';

/**
 * The one gate in front of every admin URL.
 *
 * It is exported so a site that mounts its own admin routes can put them
 * behind the same guard, and so the ordering is testable.
 */
export const guard: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  if (crossSiteWrite(c)) return c.text(CROSS_SITE_REFUSAL, 403);

  const admin = c.var.admin;
  const dataDir = c.var.config.dataDir;
  // The decoded path the router dispatches on, so every decision below is made
  // about the handler that will actually run.
  const pathname = c.req.path;

  // Reading a session prunes it when it has expired, so an expired session is
  // gone from here on, not merely ignored.
  const sessionId = sessionIdFrom(c);
  let session = liveSession(
    admin,
    dataDir,
    sessionId === undefined ? undefined : admin.getSession(sessionId),
  );
  if (retireOldSessionCookie(c) && session === undefined) {
    session = startSession(c, undefined);
    admin.pushFlash(session.id, { kind: 'notice', message: RENAMED_COOKIE_NOTICE });
  }
  c.set('session', session);

  const isSetup = pathname === SETUP_PATH;
  // The three screens somebody with no login is allowed to reach: the login
  // form, and the two halves of forgetting a password. Everything
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
      const returnable = c.req.method === 'GET' && RETURNABLE_PATHS.has(pathname);
      const search = new URL(c.req.url).search;
      return c.redirect(
        returnable
          ? `${LOGIN_PATH}?${RETURN_TO_FIELD}=${encodeURIComponent(`${pathname}${search}`)}`
          : LOGIN_PATH,
        302,
      );
    }
  }

  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const form = await boundedForm(c, pathname, session?.userId != null);
    if (form instanceof Response) return form;
    const token = await form.field(CSRF_FIELD);
    if (session === undefined && (isSetup || isAnonymous) && typeof token === 'string') {
      return expiredForm(c, pathname, form);
    }
    if (session === undefined || !csrfTokenMatches(session.csrfToken, token)) {
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
 * hold, or holds under another uid, is deleted, and the request is anonymous.
 * That is exactly what makes a login survive a rebuilt database only as far as
 * the file still holds the person it was made for.
 */
function liveSession(
  admin: AdminStore,
  dataDir: string,
  session: Session | undefined,
): Session | undefined {
  if (session === undefined || session.userId === null) return session;
  const issued = {
    userId: session.userId,
    userUid: session.userUid,
    issuedAt: session.createdAt,
  };
  if (userIssuedTo(dataDir, issued) !== undefined) return session;

  admin.deleteSession(session.id);
  return undefined;
}

const ANONYMOUS_FORM_MAX_BYTES = 64 * 1024;

const SIGNED_IN_FORM_MAX_BYTES = 8 * 1024 * 1024;

const UPLOAD_PATHS: ReadonlySet<string> = new Set([UPLOADS_PATH, MEDIA_UPLOAD_PATH]);

/** A request body already cut to its limit, so reading its fields cannot buffer more. */
interface BoundedForm {
  field(name: string): Promise<unknown>;
}

async function boundedForm(
  c: Context<GeekityEnv>,
  pathname: string,
  signedIn: boolean,
): Promise<Response | BoundedForm> {
  const form: BoundedForm = { field: (name) => submittedField(c, name) };
  if (c.req.raw.body === null) return form;
  const upload = signedIn && UPLOAD_PATHS.has(pathname);
  const limit = upload
    ? uploadBodyLimit(c.var.config)
    : signedIn
      ? SIGNED_IN_FORM_MAX_BYTES
      : ANONYMOUS_FORM_MAX_BYTES;

  const read = await readWithin(c.req.raw, limit, 'refuse');
  if (read !== undefined) {
    c.req.raw = new Request(c.req.raw, { body: read.body });
    return form;
  }
  if (upload) return uploadTooLarge(c);
  return c.text(`That form is larger than the ${String(limit)} bytes the admin accepts.`, 413);
}

async function submittedField(c: Context<GeekityEnv>, name: string): Promise<unknown> {
  const contentType = c.req.header('content-type') ?? '';
  if (
    !contentType.includes('application/x-www-form-urlencoded') &&
    !contentType.includes('multipart/form-data')
  ) {
    return undefined;
  }
  // Hono caches the parsed form, so the handler behind this parses nothing twice.
  const body = await c.req.parseBody();
  return body[name];
}

const EXPIRED_FORM_NOTICE = 'That form expired before it was sent. Please try again.';

async function expiredForm(
  c: Context<GeekityEnv>,
  pathname: string,
  form: BoundedForm,
): Promise<Response> {
  const session = startSession(c, undefined);
  c.var.admin.pushFlash(session.id, { kind: 'warning', message: EXPIRED_FORM_NOTICE });

  const query = new URLSearchParams();
  if (pathname === RESET_PATH) {
    const token = await form.field(RECOVERY_FIELDS.token);
    if (typeof token === 'string' && token !== '') query.set(RECOVERY_FIELDS.token, token);
  } else if (pathname === LOGIN_PATH) {
    const returnTo = returnPath(await form.field(RETURN_TO_FIELD));
    if (returnTo !== undefined) query.set(RETURN_TO_FIELD, returnTo);
  }
  const search = query.size === 0 ? '' : `?${query.toString()}`;
  return c.redirect(`${pathname}${search}`, 303);
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
