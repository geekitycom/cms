import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { Environment } from 'nunjucks';

import type { GeekityEnv } from '../env.ts';
import { credentialProblem } from './credentials.ts';
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
import { ADMIN_TEMPLATES, createAdminTemplateEnvironment } from './templates.ts';

/** Where the login form lives. */
export const LOGIN_PATH = `${ADMIN_PREFIX}/login`;
/** Where the first-run form lives. */
export const SETUP_PATH = `${ADMIN_PREFIX}/setup`;
/** Where the logout form posts. */
export const LOGOUT_PATH = `${ADMIN_PREFIX}/logout`;

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

  function render(
    c: Context<GeekityEnv>,
    template: string,
    context: Record<string, unknown>,
  ): Response {
    const html = templates(c).render(template, { site: c.var.renderer.site(), ...context });
    return c.html(html);
  }

  app.use(ADMIN_PREFIX, guard);
  app.use(`${ADMIN_PREFIX}/*`, guard);

  app.get(SETUP_PATH, (c) => {
    const session = anonymousSession(c);
    return render(c, ADMIN_TEMPLATES.setup, {
      csrfToken: session.csrfToken,
      setupUrl: SETUP_PATH,
      username: '',
    });
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
    const session = anonymousSession(c);
    return render(c, ADMIN_TEMPLATES.login, {
      csrfToken: session.csrfToken,
      loginUrl: LOGIN_PATH,
      username: '',
    });
  });

  app.post(LOGIN_PATH, async (c) => {
    const body = await c.req.parseBody();
    const username = text(body[USERNAME_FIELD]).trim();
    const password = text(body[PASSWORD_FIELD]);

    const user = c.var.admin.verifyPassword(username, password);
    if (user === undefined) {
      // One message for both failures, so the form cannot be used to find out
      // which usernames exist.
      const session = anonymousSession(c);
      c.status(401);
      return render(c, ADMIN_TEMPLATES.login, {
        csrfToken: session.csrfToken,
        loginUrl: LOGIN_PATH,
        username,
        error: 'That username and password do not match.',
      });
    }

    return logIn(c, user);
  });

  app.post(LOGOUT_PATH, (c) => {
    const session = c.var.session;
    if (session !== undefined) c.var.admin.deleteSession(session.id);
    clearSessionCookie(c, c.var.config);
    return c.redirect(LOGIN_PATH, 303);
  });

  app.get(ADMIN_PREFIX, (c) => {
    const session = c.var.session;
    const user =
      session?.userId === null ? undefined : c.var.admin.getUserById(session?.userId ?? 0);
    return render(c, ADMIN_TEMPLATES.dashboard, {
      csrfToken: session?.csrfToken ?? '',
      logoutUrl: LOGOUT_PATH,
      user,
    });
  });

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
    const session = anonymousSession(c);
    c.status(400);
    return render(c, ADMIN_TEMPLATES.setup, {
      csrfToken: session.csrfToken,
      setupUrl: SETUP_PATH,
      username,
      error,
    });
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
