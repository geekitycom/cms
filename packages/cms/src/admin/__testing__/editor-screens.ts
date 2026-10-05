import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { pngWithMetadata } from '../../__testing__/metadata.ts';
import type { Cms } from '../../index.ts';
import { fieldsOf } from './editor-form.ts';
import { csrfField, signedIn } from './harness.ts';
import type { Browser, Sandbox } from './harness.ts';

/**
 * One site holding everything the editor can show, and the editor and conflict
 * screens as a signed-in admin is served them. `editor-daisyui.test.ts` reads
 * them from the old admin in its own process and from the DaisyUI admin through
 * `editor-probe.ts`, so the form each admin posts can be held to be the same.
 */

const NOW = new Date('2026-10-03T12:00:00.000Z');

/** A reposted image the site fetches and keeps a card for. */
export const IMAGE = 'https://edu.example/files/calculator.png';

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09]);

/** Every box of a post filled in, the reposted image among them. */
export const FILLED: Readonly<Record<string, string>> = {
  title: 'Everything',
  slug: 'everything',
  date: '2026-10-02 09:00',
  tags: 'one',
  body: 'Every box.',
  'photo-url-0': 'https://example.com/a.jpg',
  'photo-alt-0': 'A photo',
  'location-name': 'The pier',
  'enclosure-url': '/uploads/2026/10/episode.mp3',
  'alternate-url-0': '/uploads/2026/10/episode.mp4',
  'repost-of': IMAGE,
  'read-status': 'finished',
  'read-of-name': 'A book',
  lang: 'fr',
  'syndicate-to-mastodon': '1',
  comments: 'closed',
};

/** The screens, by the name the test calls each one. */
export type EditorScreen = 'newPost' | 'newPage' | 'filled' | 'refused' | 'trashed' | 'conflict';

export interface Served {
  status: number;
  html: string;
}

/** Serve the reposted image, and nothing else, to the site's fetches. */
async function fakeTheWeb(): Promise<() => void> {
  const png = await pngWithMetadata();
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new Request(input).url;
    if (url === IMAGE) {
      return Promise.resolve(new Response(png, { headers: { 'content-type': 'image/png' } }));
    }
    return Promise.resolve(new Response('gone', { status: 404 }));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function write(
  contentDir: string,
  file: string,
  contents: string | Uint8Array,
): Promise<void> {
  const target = path.join(contentDir, ...file.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

/** A site with a filled-in post, a trashed one and the uploads the editor offers. */
export async function editorSite(
  box: Sandbox,
  baseUrl = 'https://blog.example',
): Promise<{ cms: Cms; agent: Browser; restore: () => void }> {
  const restore = await fakeTheWeb();
  const contentDir = await box.dir('geekity-editor-screens-');
  await write(contentDir, 'uploads/2026/10/episode.mp3', MP3);
  await write(contentDir, 'uploads/2026/10/episode.mp4', new Uint8Array(32));
  await write(
    contentDir,
    '_data/syndicationTargets.json',
    JSON.stringify([{ id: 'mastodon', name: 'Mastodon', url: 'https://brid.gy/publish/mastodon' }]),
  );
  await write(
    contentDir,
    '_trash/posts/2026-09-03-thrown-away.md',
    "---\ntitle: Thrown away\ndate: '2026-09-03T09:00:00Z'\npermalink: /2026/09/thrown-away/\n---\n\nGone.\n",
  );

  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-editor-screens-data-'),
    baseUrl,
    now: () => NOW,
    requireAltText: true,
    hostLookup: () => Promise.resolve(['203.0.113.7']),
  });
  const agent = await signedIn(cms);

  const token = csrfField(await (await agent.get('/admin/posts/new')).text());
  assert.ok(token !== undefined, 'the editor carried a CSRF token');
  const saved = await agent.post('/admin/posts/new', {
    csrf_token: token,
    action: 'publish',
    ...FILLED,
  });
  assert.equal(saved.status, 303, await saved.clone().text());
  await cms.replyContexts.settled();

  return { cms, agent, restore };
}

async function served(response: Response): Promise<Served> {
  return { status: response.status, html: await response.text() };
}

/** Every editor screen over one seeded site. */
export async function editorScreens(box: Sandbox): Promise<Record<EditorScreen, Served>> {
  const { agent, restore } = await editorSite(box);
  try {
    const filled = await served(await agent.get('/admin/posts/everything'));

    const blank = await (await agent.get('/admin/posts/new')).text();
    const refused = await served(
      await agent.post('/admin/posts/new', {
        csrf_token: csrfField(blank) ?? '',
        action: 'publish',
        'repost-of': IMAGE,
      }),
    );

    const stale = fieldsOf(filled.html).map(([name, value]): [string, string] =>
      name === 'hash' ? [name, 'stale'] : [name, value],
    );
    const conflict = await served(
      await agent.post('/admin/posts/everything', [...stale, ['action', 'update']]),
    );

    return {
      newPost: await served(await agent.get('/admin/posts/new')),
      newPage: await served(await agent.get('/admin/pages/new')),
      filled,
      refused,
      trashed: await served(await agent.get('/admin/posts/thrown-away')),
      conflict,
    };
  } finally {
    restore();
  }
}
