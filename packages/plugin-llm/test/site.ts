import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createCms } from '@geekity/cms';
import type { Cms, Plugin } from '@geekity/cms';

/** A site with the plugins installed and enabled, and an admin signed in to it. */

export const SCREEN = '/admin/plugins/@geekity/plugin-llm';
const ADA = { username: 'ada', password: 'correct horse battery' };

export interface Admin {
  get(url: string): Promise<Response>;
  /** Post a form from the page at `from`, with its CSRF token. */
  post(url: string, fields: Record<string, string>): Promise<Response>;
}

const opened: Cms[] = [];
const dirs: string[] = [];

export async function closeSites(): Promise<void> {
  for (const cms of opened) await cms.close();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

export async function llmSite(
  ...plugins: Plugin[]
): Promise<{ cms: Cms; admin: Admin; contentDir: string; dataDir: string }> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-llm-data-'));
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-llm-content-'));
  dirs.push(dataDir, contentDir);
  mkdirSync(path.join(contentDir, '_data'), { recursive: true });
  writeFileSync(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({
      title: 'Geekity',
      plugins: Object.fromEntries(plugins.map((plugin) => [plugin.name, { enabled: true }])),
    }),
  );
  writeAda(dataDir);
  const cms = createCms({ dataDir, contentDir, watch: false, plugins });
  opened.push(cms);
  return { cms, admin: await signIn(cms), contentDir, dataDir };
}

async function signIn(cms: Cms): Promise<Admin> {
  let cookie = '';
  const remember = (response: Response): Response => {
    const set = response.headers.get('set-cookie');
    if (set !== null) cookie = set.split(';')[0] ?? '';
    return response;
  };
  const token = (html: string) => /name="csrf_token"\s+value="([^"]+)"/.exec(html)?.[1] ?? '';
  const send = async (url: string, fields: Record<string, string>) =>
    remember(
      await cms.app.request(url, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      }),
    );

  const login = await remember(await cms.app.request('/admin/login')).text();
  const response = await send('/admin/login', { csrf_token: token(login), ...ADA });
  if (response.status !== 303) throw new Error(`Sign-in answered ${String(response.status)}.`);

  const admin: Admin = {
    get: async (url) => remember(await cms.app.request(url, { headers: { cookie } })),
    post: async (url, fields) => {
      const page = await (await admin.get(url)).text();
      return send(url, { csrf_token: token(page), ...fields });
    },
  };
  return admin;
}

/** The flash messages on a page. */
export function flashes(html: string): string[] {
  return [
    ...html.matchAll(/<div role="status" class="alert alert-\w+">\s*<span>([\s\S]*?)<\/span>/g),
  ].map(([, message]) => message ?? '');
}

/**
 * `users.json` with Ada in it, written straight. Her password is hashed at
 * argon2id's smallest cost; sign-in honours the cost a hash records, so it
 * checks her in well under a millisecond where the site's own cost takes
 * tens, and the test never spends a hash of its own.
 */
function writeAda(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const ada = {
    id: 1,
    username: ADA.username,
    passwordHash:
      '$argon2id$v=19$m=8,t=1,p=1$Z2Vla2l0eS10ZXN0LXNhbA$NsFbSo8eArho8Bui32EukJ/FbrTl8bMJovDFMH9DCbQ',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify({ users: [ada], nextId: 2 }), {
    mode: 0o600,
  });
}
