import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createCms } from '../../index.ts';
import type { Cms, GeekityConfig } from '../../index.ts';

/**
 * The pieces every admin HTTP test needs: a throwaway site, a thing that keeps
 * a cookie between requests, and the two-step dance that creates the first
 * admin. They live here rather than in one test file because the admin's tests
 * are split by screen and every one of them needs to be logged in.
 */

/** Everything a test opened, so one `after` hook can put it all back. */
export interface Sandbox {
  /** Close every CMS and delete every temporary directory. */
  cleanup(): Promise<void>;
  /** A directory that goes away with the sandbox. */
  dir(prefix: string): Promise<string>;
  /** A CMS over empty content and data directories of its own. */
  site(config?: GeekityConfig): Promise<Cms>;
}

/** Open a sandbox. Call {@link Sandbox.cleanup} from the file's `after` hook. */
export function sandbox(): Sandbox {
  const started: Cms[] = [];
  const dirs: string[] = [];

  return {
    async cleanup() {
      for (const instance of started) await instance.close();
      await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    },

    async dir(prefix) {
      const created = await mkdtemp(path.join(tmpdir(), prefix));
      dirs.push(created);
      return created;
    },

    async site(config = {}) {
      const contentDir = await this.dir('geekity-admin-content-');
      const dataDir = await this.dir('geekity-admin-data-');
      const instance = createCms({ contentDir, dataDir, watch: false, ...config });
      started.push(instance);
      await instance.sync();
      return instance;
    },
  };
}

/** The value of a `Set-Cookie` for `name`, or `undefined`. */
export function cookieValue(response: Response, name: string): string | undefined {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const [key, ...rest] = (pair ?? '').split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

/** The whole `Set-Cookie` line for `name`, attributes included. */
export function setCookie(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`));
}

/** The value of the hidden CSRF field in a rendered form. */
export function csrfField(html: string): string | undefined {
  const match = /name="csrf_token"\s+value="([^"]+)"/.exec(html);
  return match?.[1];
}

/**
 * A thing that keeps a session cookie between requests, the way a browser
 * does. Every admin flow needs one, and hand-threading the cookie through each
 * assertion would bury what is being tested.
 */
export interface Browser {
  get(url: string): Promise<Response>;
  post(url: string, fields: Record<string, string>): Promise<Response>;
  /** The session cookie value currently held, or `undefined`. */
  session(): string | undefined;
  /** Force the held cookie, for the tests about a stale or planted one. */
  setSession(value: string | undefined): void;
}

export function browser(cms: Cms): Browser {
  let cookie: string | undefined;

  function remember(response: Response): Response {
    const value = cookieValue(response, 'geekity_session');
    if (value !== undefined) cookie = value === '' ? undefined : value;
    return response;
  }

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return cookie === undefined ? extra : { ...extra, cookie: `geekity_session=${cookie}` };
  }

  return {
    async get(url) {
      return remember(await cms.app.request(url, { headers: headers() }));
    },
    async post(url, fields) {
      const body = new URLSearchParams(fields).toString();
      return remember(
        await cms.app.request(url, {
          method: 'POST',
          headers: headers({ 'content-type': 'application/x-www-form-urlencoded' }),
          body,
        }),
      );
    },
    session() {
      return cookie;
    },
    setSession(value) {
      cookie = value;
    },
  };
}

/** The credentials {@link setUpFirstAdmin} uses when a test does not care. */
export const FIRST_ADMIN = { username: 'ada', password: 'correct horse battery' };

/** Walk the setup form and create the first admin. Returns the redirect. */
export async function setUpFirstAdmin(
  agent: Browser,
  credentials = FIRST_ADMIN,
): Promise<Response> {
  const form = await agent.get('/admin/setup');
  const token = csrfField(await form.text());
  assert.ok(token !== undefined, 'the setup form carried a CSRF token');

  return agent.post('/admin/setup', {
    csrf_token: token,
    username: credentials.username,
    password: credentials.password,
    password_confirmation: credentials.password,
  });
}

/** A browser that has logged in through the login form. */
export async function signIn(cms: Cms, credentials = FIRST_ADMIN): Promise<Browser> {
  const agent = browser(cms);
  const token = csrfField(await (await agent.get('/admin/login')).text());
  assert.ok(token !== undefined, 'the login form carried a CSRF token');

  const response = await agent.post('/admin/login', {
    csrf_token: token,
    username: credentials.username,
    password: credentials.password,
  });
  assert.equal(response.status, 303, 'the credentials were accepted');
  return agent;
}

/** A browser that is already signed in as the site's first admin. */
export async function signedIn(cms: Cms): Promise<Browser> {
  const agent = browser(cms);
  await setUpFirstAdmin(agent);
  return agent;
}
