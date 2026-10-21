import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createCms, createUser } from '@geekity/cms';
import type { Cms, Plugin } from '@geekity/cms';

/**
 * A site with the Umami plugin enabled, a post and a page, its settings
 * written to the plugin's data folder, and an admin who can sign in. Copied in
 * shape from plugin-post-summary's test site rather than imported across
 * packages.
 */

const ADA = { username: 'ada', password: 'correct horse battery' };
export const UMAMI = '@geekity/plugin-umami';

export const PAGES = ['/', '/2026/10/hello/', '/about/', '/tag/notes/', '/nothing-here/'];

export interface Admin {
  get(url: string): Promise<Response>;
  /** Post a form with the session's CSRF token. */
  post(url: string, fields: Record<string, string>): Promise<Response>;
}

export interface SiteOptions {
  /** The plugin's public settings, as `settings.json` holds them. */
  settings?: Record<string, string | boolean>;
  devMode?: boolean;
}

const opened: Cms[] = [];
const dirs: string[] = [];

export async function closeSites(): Promise<void> {
  for (const cms of opened) await cms.close();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

export async function umamiSite(plugin: Plugin, options: SiteOptions = {}): Promise<Cms> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-umami-data-'));
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-umami-content-'));
  dirs.push(dataDir, contentDir);
  mkdirSync(path.join(contentDir, '_data'), { recursive: true });
  mkdirSync(path.join(contentDir, 'posts'), { recursive: true });
  mkdirSync(path.join(contentDir, 'pages'), { recursive: true });
  writeFileSync(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({
      title: 'Geekity',
      language: 'en',
      notifyServer: '',
      plugins: { [UMAMI]: { enabled: true } },
    }),
  );
  writeFileSync(
    path.join(contentDir, 'posts', 'hello.md'),
    "---\ntitle: Hello\ndate: '2026-10-02T09:00:00Z'\npermalink: /2026/10/hello/\ntags:\n  - notes\n---\n\nBody.\n",
  );
  writeFileSync(
    path.join(contentDir, 'pages', 'about.md'),
    '---\ntitle: About\npermalink: /about/\n---\n\nAbout us.\n',
  );
  if (options.settings !== undefined) {
    const folder = path.join(dataDir, 'plugins', UMAMI);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'settings.json'), JSON.stringify(options.settings));
  }
  await createUser({ dataDir, ...ADA });
  const cms = createCms({
    dataDir,
    contentDir,
    watch: false,
    devMode: options.devMode ?? false,
    plugins: [plugin],
    hostLookup: (hostname) => Promise.reject(new Error(`a test resolves no names: ${hostname}`)),
  });
  opened.push(cms);
  await cms.sync();
  return cms;
}

export async function signIn(cms: Cms): Promise<Admin> {
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
    post: async (url, fields) =>
      send(url, {
        csrf_token: tokenIn(await (await admin.get('/admin/posts/new')).text()),
        ...fields,
      }),
  };
  return admin;
}

export async function anonymous(cms: Cms, pathname: string): Promise<string> {
  return await (await cms.app.request(pathname)).text();
}

/** Every Umami script tag on a page. */
export function trackersOn(html: string): string[] {
  return [...html.matchAll(/<script src="[^"]*\/script\.js"[^>]*><\/script>/g)].map(([tag]) => tag);
}
