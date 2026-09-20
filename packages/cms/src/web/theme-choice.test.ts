/**
 * Named themes, from the outside: a `themes/` directory of them and one
 * setting in `content/_data/site.json` that says which one the site is wearing
 * (decision-15).
 *
 * Everything here goes through HTTP, because the question is never which file
 * was read — it is what the site serves: whose layout drew the page, whose
 * stylesheet `/theme/` answered with, what the editor's preview shows, and
 * what happens to all three when the setting changes or the theme it names
 * stops being there.
 */
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Cms, GeekityConfig } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

/** A post the packaged theme and an overriding one both have something to say about. */
const POST = [
  '---',
  'title: Hello',
  "date: '2026-09-02T09:00:00Z'",
  'permalink: /2026/09/hello/',
  '---',
  '',
  'Body.',
  '',
].join('\n');

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/** What a theme that overrides the post layout and the stylesheet says. */
function themeFiles(name: string): Record<string, string> {
  return {
    'theme.json': JSON.stringify({ name, kind: 'site' }),
    'layouts/post.njk': `<!doctype html><h1>${name}: {{ title }}</h1>{{ content | safe }}`,
    'static/style.css': `/* ${name} */\n`,
  };
}

/** A site with a themes directory holding `themes`, and whatever it has chosen. */
async function site(
  options: {
    themes?: readonly string[];
    chosen?: string;
    config?: GeekityConfig;
  } = {},
): Promise<{ cms: Cms; contentDir: string; themesDir: string }> {
  const contentDir = await box.dir('geekity-theme-content-');
  const dataDir = await box.dir('geekity-theme-data-');
  const themesDir = await box.dir('geekity-theme-themes-');

  for (const name of options.themes ?? []) {
    await writeTree(path.join(themesDir, name), themeFiles(name));
  }
  await writeTree(contentDir, {
    'posts/2026-09-02-hello.md': POST,
    ...siteJson(options.chosen),
  });

  const cms = await box.open({ contentDir, dataDir, themesDir, ...options.config });
  return { cms, contentDir, themesDir };
}

/** The `_data/site.json` of a site wearing `chosen`, or none at all. */
function siteJson(chosen?: string): Record<string, string> {
  return {
    '_data/site.json': JSON.stringify({
      title: 'A Site',
      ...(chosen === undefined ? {} : { theme: chosen }),
    }),
  };
}

/** Write the theme choice into a running site's `site.json`. */
async function choose(contentDir: string, chosen?: string): Promise<void> {
  await writeTree(contentDir, siteJson(chosen));
}

/** GET a path and read the body. */
async function body(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

/** Whatever `console.warn` is told while `run` is running. */
async function warnings(run: () => Promise<void>): Promise<string[]> {
  const said: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]): void => {
    said.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return said;
}

describe('a site that has chosen no theme', () => {
  it('renders the packaged theme however many themes are sitting in the directory', async () => {
    const { cms } = await site({ themes: ['midnight', 'daylight'] });

    const post = await body(cms, '/2026/09/hello/');
    assert.match(
      post,
      /<article class="blog-post h-entry">/,
      'the packaged post layout drew the page',
    );
    assert.doesNotMatch(post, /midnight|daylight/, 'no unchosen theme reached the page');

    const stylesheet = await body(cms, '/theme/style.css');
    assert.doesNotMatch(stylesheet, /midnight|daylight/, 'nor the stylesheet');
  });
});

describe('a site wearing one of its themes', () => {
  it('reads its pages and its assets out of that theme, packaged theme behind it', async () => {
    const { cms } = await site({ themes: ['midnight', 'daylight'], chosen: 'midnight' });

    assert.match(await body(cms, '/2026/09/hello/'), /<h1>midnight: Hello<\/h1>/);
    assert.equal(await body(cms, '/theme/style.css'), '/* midnight */\n');
    // Everything the theme did not write still comes from the package, one
    // file at a time: it ships a post layout and a stylesheet and nothing else.
    assert.match(await body(cms, '/'), /class="feed h-feed"/);
    assert.doesNotMatch(await body(cms, '/'), /midnight: /);
  });

  it('shows the editor preview through it too, since a preview is the page', async () => {
    const { cms } = await site({ themes: ['midnight'], chosen: 'midnight' });
    const agent = await signedIn(cms);
    const token = csrfField(await (await agent.get('/admin/posts/new')).text());
    assert.ok(token !== undefined, 'the editor carried a CSRF token');

    const response = await agent.post('/admin/preview', {
      csrf_token: token,
      type: 'post',
      title: 'Unsaved',
      body: 'Nothing is written yet.\n',
    });

    assert.equal(response.status, 200);
    assert.match(await response.text(), /<h1>midnight: Unsaved<\/h1>/);
  });

  it('renders the admin out of the admin, whatever the site is wearing', async () => {
    const { cms, themesDir } = await site({ themes: ['midnight'], chosen: 'midnight' });
    // A theme claiming the admin's own template names. The admin is not a
    // theme and is not overridable (decision-4), so these must do nothing.
    await writeTree(path.join(themesDir, 'midnight'), {
      'pages/account/login.njk': '<!doctype html><p>the theme wrote the login form</p>',
      'pages/dashboard/home.njk': '<!doctype html><p>the theme wrote the dashboard</p>',
    });
    await signedIn(cms);

    const login = await body(cms, '/admin/login');

    assert.doesNotMatch(login, /the theme wrote/, 'the site theme did not reach the admin');
    assert.ok(csrfField(login) !== undefined, 'the real login form, CSRF field and all');
  });
});

describe('changing the theme', () => {
  for (const watch of [false, true]) {
    it(`takes effect on the next request with watch ${watch ? 'on' : 'off'}`, async () => {
      const { cms, contentDir } = await site({
        themes: ['midnight', 'daylight'],
        config: { watch },
      });
      assert.match(await body(cms, '/2026/09/hello/'), /<article class="blog-post h-entry">/);

      await choose(contentDir, 'midnight');
      assert.match(await body(cms, '/2026/09/hello/'), /<h1>midnight: Hello<\/h1>/);
      assert.equal(await body(cms, '/theme/style.css'), '/* midnight */\n');

      await choose(contentDir, 'daylight');
      assert.match(await body(cms, '/2026/09/hello/'), /<h1>daylight: Hello<\/h1>/);
      assert.equal(await body(cms, '/theme/style.css'), '/* daylight */\n');

      await choose(contentDir, undefined);
      assert.match(await body(cms, '/2026/09/hello/'), /<article class="blog-post h-entry">/);
    });
  }

  it('falls back to the packaged theme, with a warning, when the theme has gone', async () => {
    const { cms, themesDir } = await site({ themes: ['midnight'], chosen: 'midnight' });
    assert.match(await body(cms, '/2026/09/hello/'), /<h1>midnight: Hello<\/h1>/);

    await rm(path.join(themesDir, 'midnight'), { recursive: true, force: true });

    const said = await warnings(async () => {
      assert.match(await body(cms, '/2026/09/hello/'), /<article class="blog-post h-entry">/);
      assert.match(await body(cms, '/theme/style.css'), /body/);
      assert.equal((await cms.app.request('/nothing-here/')).status, 404);
    });

    assert.equal(said.length, 1, 'said once, not once per request');
    assert.match(said[0] ?? '', /midnight/);
  });

  it('says so at boot rather than at whatever request arrives first', async () => {
    const contentDir = await box.dir('geekity-theme-boot-content-');
    const dataDir = await box.dir('geekity-theme-boot-data-');
    const themesDir = await box.dir('geekity-theme-boot-themes-');
    await writeTree(contentDir, { ...siteJson('nothing-like-this') });

    const said = await warnings(async () => {
      await box.open({ contentDir, dataDir, themesDir });
    });

    assert.equal(said.length, 1);
    assert.match(said[0] ?? '', /nothing-like-this/);
  });
});
