import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createCms, createUser } from '@geekity/cms';
import type { Cms, Plugin } from '@geekity/cms';

/**
 * A site with the LLM and post summary plugins enabled, the LLM pointed at a
 * fake provider, and an admin signed in. Copied in shape from plugin-llm's
 * own test site rather than imported across packages.
 */

const ADA = { username: 'ada', password: 'correct horse battery' };
export const SUMMARY = '@geekity/plugin-post-summary';
export const LLM = '@geekity/plugin-llm';

export interface Admin {
  get(url: string): Promise<Response>;
  /** Post a form with the session's CSRF token. */
  post(url: string, fields: Record<string, string>): Promise<Response>;
  /** The CSRF token the editor pages carry. */
  token(): Promise<string>;
}

export interface SiteOptions {
  /** The fake provider's base URL. */
  baseUrl: string;
  /** The LLM's default model, `acme/tiny-1` unless named. */
  model?: string;
  /** The API key, or none, leaving the LLM unconfigured. */
  apiKey?: string | undefined;
  /** Files under `content/posts/`, by name. */
  posts?: Record<string, string>;
  /** Whether the post summary plugin is enabled; the LLM always is. */
  enabled?: boolean;
}

const opened: Cms[] = [];
const dirs: string[] = [];

export async function closeSites(): Promise<void> {
  for (const cms of opened) await cms.close();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

export async function summarySite(
  plugins: Plugin[],
  options: SiteOptions,
): Promise<{ cms: Cms; admin: Admin; contentDir: string }> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-summary-data-'));
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-summary-content-'));
  dirs.push(dataDir, contentDir);
  mkdirSync(path.join(contentDir, '_data'), { recursive: true });
  mkdirSync(path.join(contentDir, 'posts'), { recursive: true });
  writeFileSync(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({
      title: 'Geekity',
      language: 'en',
      notifyServer: '',
      plugins: {
        [LLM]: {
          enabled: true,
          base_url: options.baseUrl,
          default_model: options.model ?? 'acme/tiny-1',
        },
        [SUMMARY]: { enabled: options.enabled ?? true },
      },
    }),
  );
  for (const [name, text] of Object.entries(options.posts ?? {})) {
    writeFileSync(path.join(contentDir, 'posts', name), text);
  }
  if (options.apiKey !== undefined) {
    const folder = path.join(dataDir, 'plugins', LLM);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'secrets.json'), JSON.stringify({ api_key: options.apiKey }), {
      mode: 0o600,
    });
  }
  await createUser({ dataDir, ...ADA });
  const cms = createCms({
    dataDir,
    contentDir,
    watch: false,
    plugins,
    hostLookup: (hostname) => Promise.reject(new Error(`a test resolves no names: ${hostname}`)),
  });
  opened.push(cms);
  await cms.sync();
  return { cms, admin: await signIn(cms), contentDir };
}

async function signIn(cms: Cms): Promise<Admin> {
  let cookie = '';
  const remember = (response: Response): Response => {
    const set = response.headers.get('set-cookie');
    if (set !== null) cookie = set.split(';')[0] ?? '';
    return response;
  };
  const tokenIn = (html: string) => /name="csrf_token"\s+value="([^"]+)"/.exec(html)?.[1] ?? '';
  const send = async (url: string, fields: Record<string, string>) =>
    remember(
      await cms.app.request(url, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      }),
    );

  const login = await remember(await cms.app.request('/admin/login')).text();
  const response = await send('/admin/login', { csrf_token: tokenIn(login), ...ADA });
  if (response.status !== 303) throw new Error(`Sign-in answered ${String(response.status)}.`);

  const admin: Admin = {
    get: async (url) => remember(await cms.app.request(url, { headers: { cookie } })),
    post: async (url, fields) => send(url, { csrf_token: await admin.token(), ...fields }),
    token: async () => tokenIn(await (await admin.get('/admin/posts/new')).text()),
  };
  return admin;
}

/** Where an action of this plugin is pressed. */
export function actionUrl(id: string): string {
  return `/admin/plugins/${SUMMARY}/editor/${id}`;
}

/** The labels of the plugin buttons an editor page draws. */
export function buttonsOn(html: string): string[] {
  return [
    ...html.matchAll(
      /data-editor-action="[^"]*"[^>]*>\s*<button type="button"[^>]*hidden>([^<]*)<\/button>/g,
    ),
  ].map(([, label]) => label ?? '');
}
