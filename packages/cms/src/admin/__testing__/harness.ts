import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { seedActorKeys } from '../../federation/__testing__/keys.ts';
import { createCms } from '../../index.ts';
import type { Cms, GeekityConfig } from '../../index.ts';

/**
 * The pieces every admin HTTP test needs: a throwaway site, a thing that keeps
 * a cookie between requests, and the two-step dance that creates the first
 * admin. They live here rather than in one test file because the admin's tests
 * are split by screen and every one of them needs to be logged in.
 */

/**
 * What a sandbox does about a site's actor keys, beyond booting it.
 *
 * An actor's RSA pair costs about a quarter of a second to mint, and the admin
 * screens are tested by a signed-in browser rather than by anything that cares
 * which key the site holds — so every sandbox site is born with the fixture
 * pair already on disk for the name {@link setUpFirstAdmin} creates, and
 * `loadActorKeyPairs` reads it rather than minting one. See
 * `federation/__testing__/keys.ts`.
 */
export interface SandboxSiteOptions {
  /**
   * The usernames whose key files are written from the fixture before the site
   * boots. Defaults to the first admin's. A test whose subject is the minting,
   * rotation or storage of a key passes `[]` and lets the site do its own.
   */
  actorKeys?: readonly string[];
}

/** Everything a test opened, so one `after` hook can put it all back. */
export interface Sandbox {
  /** Close every CMS and delete every temporary directory. */
  cleanup(): Promise<void>;
  /** A directory that goes away with the sandbox. */
  dir(prefix: string): Promise<string>;
  /** A CMS over empty content and data directories of its own. */
  site(config?: GeekityConfig, options?: SandboxSiteOptions): Promise<Cms>;
  /**
   * A CMS over directories the caller names, closed with the sandbox.
   *
   * What {@link Sandbox.site} is built on, and what a test booting a second
   * time over the first one's directories needs: a database deleted and put
   * back is a thing decision-9 promises works, and proving it takes two boots
   * over the same content.
   */
  open(
    config: GeekityConfig & { contentDir: string; dataDir: string },
    options?: SandboxSiteOptions,
  ): Promise<Cms>;
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

    async site(config = {}, options = {}) {
      return await this.open(
        {
          contentDir: await this.dir('geekity-admin-content-'),
          dataDir: await this.dir('geekity-admin-data-'),
          ...config,
        },
        options,
      );
    },

    async open(config, options = {}) {
      for (const username of options.actorKeys ?? [FIRST_ADMIN.username]) {
        seedActorKeys(config.dataDir, username);
      }
      const instance = createCms({ watch: false, hostLookup: resolveNothing, ...config });
      started.push(instance);
      await instance.sync();
      return instance;
    },
  };
}

/**
 * A host lookup that answers nothing, so no sandbox site resolves a real name
 * when a reply's target is fetched (TASK-123). A test that wants a target read
 * names a lookup of its own.
 */
export function resolveNothing(hostname: string): Promise<readonly string[]> {
  return Promise.reject(new Error(`a test resolves no names: ${hostname}`));
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

/** One file a test posts to a multipart endpoint. */
export interface UploadedFile {
  /** The filename the browser would send. */
  name: string;
  /** The media type it would declare. */
  type: string;
  /** The bytes. */
  bytes: Uint8Array;
}

/**
 * A thing that keeps a session cookie between requests, the way a browser
 * does. Every admin flow needs one, and hand-threading the cookie through each
 * assertion would bury what is being tested.
 */
export interface Browser {
  get(url: string): Promise<Response>;
  post(url: string, fields: Record<string, string>): Promise<Response>;
  /**
   * Post one file as `multipart/form-data`, the way the editor's upload
   * control does. The CSRF token is a field of its own because the guard reads
   * it out of the multipart body exactly as it does out of a urlencoded one.
   * The field name defaults to the editor's; the avatar form uses its own.
   */
  upload(url: string, csrfToken: string, file: UploadedFile, field?: string): Promise<Response>;
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
    async upload(url, csrfToken, file, field = 'file') {
      const form = new FormData();
      form.set('csrf_token', csrfToken);
      form.set(field, new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
      return remember(
        await cms.app.request(url, { method: 'POST', headers: headers(), body: form }),
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
