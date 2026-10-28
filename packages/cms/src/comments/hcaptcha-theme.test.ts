import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import vm from 'node:vm';

import { sandbox, signIn } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import { settingsOver } from '../__testing__/settings.ts';
import { contactForm, contactFormFor, CONTACT_FIELDS, CONTACT_POST_PATH } from '../contact/form.ts';
import { parseDocument } from '../content/parser.ts';
import type { ChallengeWidget, FormChallenge } from '../forms/challenge.ts';
import { challengeWidgetOf } from '../forms/challenge.ts';
import type { Cms } from '../index.ts';
import { COMMENT_POST_PATH, commentForm, signedInCommentForm } from './form.ts';
import type { CommentViewer } from './form.ts';
import { HCAPTCHA_RESPONSE_FIELD, HCAPTCHA_SCRIPT_URL } from './hcaptcha.ts';
import { commentFormFor, drawnFor } from './page-form.ts';
import { COMMENT_FIELDS } from './submission.ts';

const box = sandbox();

after(async () => {
  await box.cleanup();
});

const NOW = new Date('2026-09-20T12:00:00.000Z');

const WIDGET: ChallengeWidget = {
  provider: 'hcaptcha',
  siteKey: 'the-site-key',
  scriptUrl: HCAPTCHA_SCRIPT_URL,
  field: HCAPTCHA_RESPONSE_FIELD,
};

const VIEWER: CommentViewer = {
  username: 'ada',
  name: 'Ada',
  url: '/author/ada/',
  email: 'ada@example.com',
  csrfToken: 'token',
};

const POST = `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`;

const CONTACT_PAGE = `---
title: Say hello
permalink: /contact/
contact: true
---

Write to me.
`;

const ADMIN = { username: 'ada', password: 'correct horse battery', email: 'ada@example.com' };

describe('the form contexts and a challenge (AC #1)', () => {
  const post = parseDocument(POST, { path: 'posts/2026-09-19-hello-world.md' });
  const page = parseDocument(CONTACT_PAGE, { path: 'pages/contact.md' });

  it('puts the widget on a stranger’s comment form and nothing on one without', () => {
    const open = { document: post, site: {}, now: NOW };
    assert.deepEqual(commentFormFor({ ...open, challenge: WIDGET })?.challenge, WIDGET);
    assert.ok(!('challenge' in (commentFormFor(open) ?? {})), 'no challenge key at all');
    assert.deepEqual(drawnFor(commentForm(post, NOW), undefined, WIDGET).challenge, WIDGET);
  });

  it('never puts it on the signed-in comment form', () => {
    const open = { document: post, site: {}, now: NOW, viewer: VIEWER, challenge: WIDGET };
    assert.ok(!('challenge' in (commentFormFor(open) ?? {})));
    assert.ok(!('challenge' in drawnFor(commentForm(post, NOW), VIEWER, WIDGET)));

    const challenged = drawnFor(commentForm(post, NOW), undefined, WIDGET);
    assert.ok(!('challenge' in signedInCommentForm(challenged, VIEWER)));
  });

  it('puts the widget on the contact form and nothing on one without', () => {
    assert.deepEqual(contactFormFor({ document: page, now: NOW, challenge: WIDGET })?.challenge, {
      ...WIDGET,
    });
    assert.ok(!('challenge' in (contactFormFor({ document: page, now: NOW }) ?? {})));
    assert.ok(!('challenge' in contactForm(page, NOW)));
  });

  it('treats a challenge whose widget throws as off', async () => {
    const warned: string[] = [];
    const broken: FormChallenge = {
      field: 'x',
      widget: () => Promise.reject(new Error('no settings')),
      verify: () => Promise.resolve('unknown'),
    };
    const logger = { warn: (message: string) => warned.push(message) };
    assert.equal(await challengeWidgetOf(broken, logger), undefined);
    assert.equal(warned.length, 1);
    assert.equal(await challengeWidgetOf(undefined, logger), undefined);
  });
});

async function site(options: { paired?: boolean; status?: string } = {}): Promise<Cms> {
  const contentDir = await box.dir('geekity-hcaptcha-theme-content-');
  const dataDir = await box.dir('geekity-hcaptcha-theme-data-');
  for (const [relative, contents] of Object.entries({
    'posts/2026-09-19-hello-world.md': POST,
    'pages/contact.md': CONTACT_PAGE,
  })) {
    const file = path.join(contentDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  writeUsers(dataDir, [ADMIN]);
  if (options.paired !== false) {
    await settingsOver({ contentDir, dataDir }).set(
      'hcaptcha',
      new Map<string, unknown>([
        ['site_key', 'the-site-key'],
        ['secret', '0xsecret'],
        ['status', options.status ?? 'valid'],
      ]),
      'admin',
    );
  }
  return await box.open({ contentDir, dataDir, baseUrl: 'https://blog.example', now: () => NOW });
}

async function html(cms: Cms, url: string): Promise<string> {
  const response = await cms.app.request(url);
  assert.equal(response.status, 200, url);
  return await response.text();
}

async function refused(cms: Cms, url: string, fields: Record<string, string>): Promise<string> {
  const response = await cms.app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  assert.equal(response.status, 400, `${url} refused the submission`);
  return await response.text();
}

function scriptSources(page: string): string[] {
  return [...page.matchAll(/<script\b([^>]*)>/g)]
    .map((match) => match[1] ?? '')
    .filter((attributes) => !/type="(?:application\/ld\+json|speculationrules)"/.test(attributes))
    .map((attributes) => /src="([^"]*)"/.exec(attributes)?.[1] ?? '(inline)');
}

function drawnWidget(page: string): { group: string; widget: string } | undefined {
  const group = /<div class="form-challenge"[\s\S]*?<\/span>\s*<\/div>/.exec(page)?.[0];
  const widget = /<div class="h-captcha"[^>]*>/.exec(page)?.[0];
  return group === undefined || widget === undefined ? undefined : { group, widget };
}

function assertChallenged(page: string, submit: string): void {
  const drawn = drawnWidget(page);
  assert.ok(drawn !== undefined, `the widget is drawn: ${page}`);
  assert.match(drawn.widget, /data-sitekey="the-site-key"/);

  const label = /aria-labelledby="([^"]+)"/.exec(drawn.group)?.[1];
  assert.ok(label !== undefined, 'the group names its label');
  assert.match(drawn.group, new RegExp(`id="${label}"[^>]*>[^<]+<`), 'the label is visible text');
  const form = page.slice(page.indexOf('<form'), page.indexOf('</form>'));
  assert.ok(form.includes(drawn.widget), 'the widget is inside the form');
  assert.ok(form.indexOf(drawn.widget) < form.indexOf(submit), 'and before the submit button');

  assert.match(drawn.group, /manual check/);

  const scripts = scriptSources(page);
  assert.equal(scripts.length, 1, `one script loads the widget: ${scripts.join(', ')}`);
  assert.match(scripts[0] ?? '', /^\/theme\/hcaptcha\.js\?v=[0-9a-f]{12}$/);
  assert.match(
    page,
    /<script src="[^"]+" data-script="https:\/\/js\.hcaptcha\.com\/1\/api\.js" defer>/,
  );
  assert.ok(page.indexOf('hcaptcha.js') > page.indexOf('</main>'), 'at the end of the body');
}

function assertUnchallenged(page: string): void {
  assert.equal(drawnWidget(page), undefined, 'no widget is drawn');
  assert.doesNotMatch(page, /h-captcha|hcaptcha/i, 'nothing about hCaptcha is on the page');
  assert.deepEqual(scriptSources(page), [], 'no script runs');
}

describe('the default theme draws the widget (AC #2, #4, #5)', () => {
  it('on the contact form and a stranger’s comment form when a pair is stored', async () => {
    const cms = await site();
    assertChallenged(await html(cms, '/contact/'), 'Send message');
    assertChallenged(await html(cms, '/2026/09/hello-world/'), 'Post comment');
  });

  it('on a refused form drawn again', async () => {
    const cms = await site();
    assertChallenged(
      await refused(cms, CONTACT_POST_PATH, {
        [CONTACT_FIELDS.page]: 'contact',
        [CONTACT_FIELDS.name]: '',
        [CONTACT_FIELDS.email]: 'grace@example.com',
        [CONTACT_FIELDS.message]: 'A message.',
        [CONTACT_FIELDS.trap]: '',
        [CONTACT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
      }),
      'Send message',
    );
    assertChallenged(
      await refused(cms, COMMENT_POST_PATH, {
        [COMMENT_FIELDS.post]: 'hello-world',
        [COMMENT_FIELDS.name]: '',
        [COMMENT_FIELDS.body]: 'A thought.',
        [COMMENT_FIELDS.trap]: '',
        [COMMENT_FIELDS.loaded]: String(NOW.getTime() - 60_000),
      }),
      'Post comment',
    );
  });

  it('on no form, and with no script, when no pair is stored or it was refused', async () => {
    for (const cms of [await site({ paired: false }), await site({ status: 'invalid' })]) {
      assertUnchallenged(await html(cms, '/contact/'));
      assertUnchallenged(await html(cms, '/2026/09/hello-world/'));
    }
  });

  it('on no form for somebody signed in', async () => {
    const cms = await site();
    const agent = await signIn(cms, ADMIN);
    const page = await (await agent.get('/2026/09/hello-world/')).text();
    assert.match(page, /Commenting as/, 'the signed-in form is drawn');
    assert.equal(drawnWidget(page), undefined);
    assert.doesNotMatch(page, /hcaptcha\.js|h-captcha/);
  });

  it('nowhere once the contact form has been sent', async () => {
    const page = await html(await site(), '/contact/?contact=sent');
    assert.match(page, /your message has been sent/);
    assertUnchallenged(page);
  });

  it('in no Markdown or gemtext', async () => {
    const cms = await site();
    for (const accept of ['text/markdown', 'text/gemini']) {
      const response = await cms.app.request('/contact/', { headers: { accept } });
      assert.equal(response.status, 200, accept);
      assert.doesNotMatch(await response.text(), /h-captcha|hcaptcha/i, accept);
    }
  });
});

const SCRIPT = fileURLToPath(new URL('../../themes/default/static/hcaptcha.js', import.meta.url));

interface Drawn {
  loaded: URL | undefined;
  rendered: { element: unknown; params: Record<string, unknown> }[];
}

async function runScript(page: {
  mode?: string;
  lang?: string;
  prefersDark?: boolean;
  widgets?: number;
}): Promise<Drawn> {
  const drawn: Drawn = { loaded: undefined, rendered: [] };
  const widgets = Array.from({ length: page.widgets ?? 1 }, (_, index) => ({
    dataset: { sitekey: `key-${String(index)}` },
  }));
  const window: Record<string, unknown> = {};
  const created: { src: string; async: boolean; defer: boolean }[] = [];
  const document = {
    currentScript: { dataset: { script: HCAPTCHA_SCRIPT_URL } },
    documentElement: {
      lang: page.lang ?? '',
      dataset: page.mode === undefined ? {} : { mode: page.mode },
    },
    querySelectorAll: (selector: string) =>
      selector === '.h-captcha[data-sitekey]' ? widgets : [],
    createElement: () => {
      const element = { src: '', async: false, defer: false };
      created.push(element);
      return element;
    },
    head: { append: () => {} },
  };
  window['matchMedia'] = (query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' && page.prefersDark === true,
  });

  vm.runInNewContext(await readFile(SCRIPT, 'utf8'), {
    window,
    document,
    URL,
    matchMedia: window['matchMedia'],
  });

  const script = created[0];
  if (script === undefined) return drawn;
  drawn.loaded = new URL(script.src);
  const onload = drawn.loaded.searchParams.get('onload') ?? '';
  window['hcaptcha'] = {
    render: (element: unknown, params: Record<string, unknown>) => {
      drawn.rendered.push({ element, params });
    },
  };
  const ready = window[onload];
  assert.equal(typeof ready, 'function', 'the onload callback is on the window');
  (ready as () => void)();
  return drawn;
}

describe('the widget script (AC #3)', () => {
  it('loads hCaptcha for explicit rendering in the page language', async () => {
    const drawn = await runScript({ lang: 'fr' });
    assert.equal(drawn.loaded?.origin + (drawn.loaded?.pathname ?? ''), HCAPTCHA_SCRIPT_URL);
    assert.equal(drawn.loaded?.searchParams.get('render'), 'explicit');
    assert.equal(drawn.loaded?.searchParams.get('hl'), 'fr');
  });

  it('draws every widget with its own site key', async () => {
    const drawn = await runScript({ widgets: 2 });
    assert.deepEqual(
      drawn.rendered.map(({ params }) => params['sitekey']),
      ['key-0', 'key-1'],
    );
  });

  it('follows the site’s colour mode, and the visitor’s when the site follows them', async () => {
    const theme = async (page: Parameters<typeof runScript>[0]): Promise<unknown> =>
      (await runScript(page)).rendered[0]?.params['theme'];
    assert.equal(await theme({ mode: 'dark' }), 'dark');
    assert.equal(await theme({ mode: 'light', prefersDark: true }), 'light');
    assert.equal(await theme({ mode: 'system', prefersDark: true }), 'dark');
    assert.equal(await theme({ mode: 'system', prefersDark: false }), 'light');
    assert.equal(await theme({ prefersDark: true }), 'dark', 'a theme with no modes follows them');
  });

  it('loads nothing on a page that draws no widget', async () => {
    const drawn = await runScript({ widgets: 0 });
    assert.equal(drawn.loaded, undefined);
  });
});
