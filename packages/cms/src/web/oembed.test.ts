/**
 * The oEmbed provider (TASK-205): `/_geekity/oembed?url=…`, which WordPress,
 * Discourse and the rest ask to turn a pasted post URL into a card, and the
 * `<link rel="alternate" type="application/json+oembed">` on every post and
 * page that tells them where it is, and the embed view (TASK-208) its html
 * frames. Asserted over HTTP against the packaged theme, the way a consumer
 * meets it.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import vm from 'node:vm';

import sharp from 'sharp';

import { createUser, setUserProfile } from '../admin/accounts.ts';
import { sandbox, signIn } from '../admin/__testing__/harness.ts';
import { generateImageVariants } from '../images/variants.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { child, parseXml } from './__testing__/xml.ts';

const box = sandbox();
after(() => box.cleanup());

const NOW = '2026-09-20T12:00:00Z';
const HERO = '/uploads/2026/09/hero.png';

const CONTENT: Record<string, string> = {
  'posts/hello.md': [
    '---',
    'title: Fish & <b>chips</b> "to go"',
    "date: '2026-09-02T09:00:00Z'",
    'permalink: /2026/09/hello/',
    'author: ada',
    "description: <script>alert('x')</script> & more",
    '---',
    '',
    'Body.',
    '',
  ].join('\n'),
  'posts/photo.md':
    "---\ntitle: A photo\ndate: '2026-09-03T09:00:00Z'\npermalink: /2026/09/photo/\nimage: /uploads/2026/09/hero.png\n---\n\nLook at it.\n",
  'posts/note.md':
    "---\ntitle: ''\ndate: '2026-09-04T09:00:00Z'\npermalink: /2026/09/note/\n---\n\nJust a short thought about embeds.\n",
  'posts/draft.md':
    "---\ntitle: Secret\ndate: '2026-09-05T09:00:00Z'\npermalink: /2026/09/secret/\ndraft: true\n---\n\nNot yet.\n",
  'posts/later.md':
    "---\ntitle: Tomorrow\ndate: '2026-12-01T09:00:00Z'\npermalink: /2026/12/later/\n---\n\nNot yet either.\n",
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout us.\n',
  'pages/home.md': '---\ntitle: Welcome\npermalink: /welcome/\n---\n\nHello there.\n',
  'pages/blog.md': '---\ntitle: Blog\npermalink: /blog/\n---\n\nThe posts.\n',
};

interface Embed {
  [field: string]: unknown;
}

/** A site with the posts above, Ada as a user, and `site.json` saying `settings`. */
async function site(
  settings: Record<string, unknown> = {},
  config: GeekityConfig = {},
): Promise<Cms> {
  const contentDir = await box.dir('geekity-oembed-content-');
  const dataDir = await box.dir('geekity-oembed-data-');

  const files = {
    ...CONTENT,
    '_data/site.json': JSON.stringify({ title: 'Words & Things', author: 'ada', ...settings }),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }

  const user = await createUser({ dataDir, username: 'ada', password: 'a password of hers' });
  await setUserProfile({ dataDir, userId: user.id, profile: { displayName: 'Ada Lovelace' } });

  return box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://blog.example',
    now: () => new Date(NOW),
    ...config,
  });
}

/** Write an image of one size to an upload path, and derive its variants so its size is recorded. */
async function upload(cms: Cms, at: string, width: number, height: number): Promise<void> {
  const file = path.join(cms.config.contentDir, ...at.slice(1).split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    await sharp({ create: { width, height, channels: 3, background: { r: 40, g: 80, b: 120 } } })
      .png()
      .toBuffer(),
  );
  await generateImageVariants(cms.config, at.slice('/uploads/'.length));
}

function endpoint(url: string, extra: Record<string, string> = {}): string {
  return `/_geekity/oembed?${new URLSearchParams({ url, ...extra }).toString()}`;
}

/** The JSON embed for `url`, after checking it is served as one. */
async function embed(cms: Cms, url: string, extra: Record<string, string> = {}): Promise<Embed> {
  const response = await cms.app.request(endpoint(url, extra));
  assert.equal(response.status, 200, url);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  return (await response.json()) as Embed;
}

/** The oEmbed discovery links in the head of the page at `pathname`. */
async function discoveryLinks(cms: Cms, pathname: string): Promise<Record<string, string>> {
  const html = await (await cms.app.request(pathname)).text();
  const head = html.slice(0, html.indexOf('</head>'));
  const links: Record<string, string> = {};
  for (const match of head.matchAll(
    /<link rel="alternate" type="((?:application\/json|text\/xml)\+oembed)" href="([^"]*)"/g,
  )) {
    links[match[1] ?? ''] = (match[2] ?? '').replaceAll('&amp;', '&');
  }
  return links;
}

describe('the discovery link (TASK-205 AC #1)', () => {
  it('is on each post and page, and names that page to the endpoint', async () => {
    const cms = await site();
    for (const pathname of ['/2026/09/hello/', '/2026/09/note/', '/about/']) {
      const links = await discoveryLinks(cms, pathname);
      const json = links['application/json+oembed'];
      assert.ok(json !== undefined, `${pathname} links no JSON oEmbed`);
      const href = new URL(json);
      assert.equal(href.origin, 'https://blog.example');
      assert.equal(href.pathname, '/_geekity/oembed');
      assert.equal(href.searchParams.get('url'), `https://blog.example${pathname}`);
      assert.equal(href.searchParams.get('format'), 'json');

      const fetched = await cms.app.request(`${href.pathname}${href.search}`);
      assert.equal(fetched.status, 200, `${pathname}: the advertised endpoint does not answer`);

      const xml = links['text/xml+oembed'];
      assert.ok(xml !== undefined, `${pathname} links no XML oEmbed`);
      assert.equal(new URL(xml).searchParams.get('format'), 'xml');
    }
  });

  it('is not on a listing, the search page or the 404', async () => {
    const cms = await site();
    for (const pathname of ['/', '/page/2/', '/search/?q=fish', '/no-such-page/']) {
      assert.deepEqual(await discoveryLinks(cms, pathname), {}, pathname);
    }
  });

  it('carries the base path of a site served from a subdirectory', async () => {
    const cms = await site({}, { baseUrl: 'https://example.com/blog' });
    const json = (await discoveryLinks(cms, '/2026/09/hello/'))['application/json+oembed'];
    assert.ok(json !== undefined);
    const href = new URL(json);
    assert.equal(href.pathname, '/blog/_geekity/oembed');
    assert.equal(href.searchParams.get('url'), 'https://example.com/blog/2026/09/hello/');
  });
});

describe('the endpoint (TASK-205 AC #2)', () => {
  it('answers a post as a rich embed with its title, author and provider', async () => {
    const cms = await site();
    const answer = await embed(cms, 'https://blog.example/2026/09/hello/');

    assert.equal(answer['version'], '1.0');
    assert.equal(answer['type'], 'rich');
    assert.equal(answer['title'], 'Fish & <b>chips</b> "to go"');
    assert.equal(answer['author_name'], 'Ada Lovelace');
    assert.equal(answer['author_url'], 'https://blog.example/author/ada/');
    assert.equal(answer['provider_name'], 'Words & Things');
    assert.equal(answer['provider_url'], 'https://blog.example/');
    assert.equal(typeof answer['html'], 'string');
    assert.equal(answer['width'], 600);
    assert.ok(typeof answer['height'] === 'number' && answer['height'] > 0);
    assert.equal(answer['thumbnail_url'], undefined, 'a post with no image has no thumbnail');
  });

  it('gives a page the site author, and a note its first words for a title', async () => {
    const cms = await site();
    const about = await embed(cms, 'https://blog.example/about/');
    assert.equal(about['title'], 'About');
    assert.equal(about['author_name'], 'Ada Lovelace');

    const note = await embed(cms, 'https://blog.example/2026/09/note/');
    assert.equal(note['title'], 'Just a short thought about embeds.');
  });

  it('gives a post with an image its thumbnail, with the size the spec requires', async () => {
    const cms = await site();
    await upload(cms, HERO, 1600, 900);
    const answer = await embed(cms, 'https://blog.example/2026/09/photo/');

    assert.equal(answer['thumbnail_url'], `https://blog.example${HERO}`);
    assert.equal(answer['thumbnail_width'], 1600);
    assert.equal(answer['thumbnail_height'], 900);
    const thumbnail = await cms.app.request(HERO);
    assert.equal(thumbnail.status, 200, 'the thumbnail is served');
  });

  it('honours maxwidth and maxheight, dropping a thumbnail that would break them', async () => {
    const cms = await site();
    await upload(cms, HERO, 1600, 900);
    const answer = await embed(cms, 'https://blog.example/2026/09/photo/', {
      maxwidth: '400',
      maxheight: '200',
    });

    assert.ok(Number(answer['width']) <= 400, `width ${String(answer['width'])}`);
    assert.ok(Number(answer['height']) <= 200, `height ${String(answer['height'])}`);
    assert.equal(answer['thumbnail_url'], undefined);
    assert.equal(answer['thumbnail_width'], undefined);
  });

  it('answers the same embed as XML when asked', async () => {
    const cms = await site();
    const response = await cms.app.request(
      endpoint('https://blog.example/2026/09/hello/', { format: 'xml' }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/xml; charset=utf-8');
    const root = parseXml(await response.text());
    assert.equal(root.name, 'oembed');
    assert.equal(child(root, 'type').text, 'rich');
    assert.equal(child(root, 'title').text, 'Fish & <b>chips</b> "to go"');
    assert.equal(child(root, 'provider_name').text, 'Words & Things');
    assert.ok(child(root, 'html').text.startsWith('<blockquote'));
  });

  it('refuses a format it does not serve with 501', async () => {
    const cms = await site();
    const response = await cms.app.request(
      endpoint('https://blog.example/2026/09/hello/', { format: 'yaml' }),
    );
    assert.equal(response.status, 501);
  });

  it('answers a repeat request with 304', async () => {
    const cms = await site();
    const at = endpoint('https://blog.example/2026/09/hello/');
    const etag = (await cms.app.request(at)).headers.get('etag');
    assert.ok(etag !== null, 'the embed carries no validator');
    const again = await cms.app.request(at, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304);
  });
});

describe('the card (TASK-205 AC #3)', () => {
  it('is a static blockquote with no script, linking back, everything escaped', async () => {
    const cms = await site();
    const html = String((await embed(cms, 'https://blog.example/2026/09/hello/'))['html']);

    assert.match(html, /^<blockquote[^>]*>[\s\S]*<\/blockquote><iframe [^>]*><\/iframe>$/);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<b>/, 'the title went out as markup');
    assert.doesNotMatch(html, /\son\w+=/i, 'an event handler');
    assert.ok(html.includes('Fish &amp; &lt;b&gt;chips&lt;/b&gt; &quot;to go&quot;'), html);
    assert.ok(html.includes('&lt;script&gt;'), 'the excerpt is shown, escaped');
    assert.ok(html.includes('href="https://blog.example/2026/09/hello/"'), 'no link back');
    assert.ok(html.includes('Ada Lovelace'), 'no author');
    assert.ok(html.includes('href="https://blog.example/author/ada/"'), 'no author link');
    assert.ok(html.includes('datetime="2026-09-02T09:00:00.000Z"'), 'no date');
    assert.ok(html.includes('Words &amp; Things'), 'no site name');
  });
});

describe('what may be embedded (TASK-205 AC #4)', () => {
  it('answers 404 for anything that is not a published post or page', async () => {
    const cms = await site();
    for (const url of [
      'https://blog.example/no-such-post/',
      'https://blog.example/2026/09/secret/',
      'https://blog.example/2026/12/later/',
      'https://elsewhere.example/2026/09/hello/',
      'https://blog.example/2026/09/hello/?p=1',
      'https://blog.example/tag/words/',
      'not a url',
      '',
    ]) {
      const response = await cms.app.request(endpoint(url));
      assert.equal(response.status, 404, url);
      const body = await response.text();
      assert.ok(!body.includes('Secret') && !body.includes('Tomorrow'), url);
    }
    assert.equal((await cms.app.request('/_geekity/oembed')).status, 404, 'no url at all');
  });

  it('never advertises a draft', async () => {
    const cms = await site();
    const links = await discoveryLinks(cms, '/2026/09/secret/');
    assert.deepEqual(links, {});
  });

  it('resolves a URL under the base path, and nothing outside it', async () => {
    const cms = await site({}, { baseUrl: 'https://example.com/blog' });
    const answer = await embed(cms, 'https://example.com/blog/2026/09/hello/');
    assert.equal(answer['provider_url'], 'https://example.com/blog/');
    assert.equal(answer['author_url'], 'https://example.com/blog/author/ada/');
    assert.ok(String(answer['html']).includes('href="https://example.com/blog/2026/09/hello/"'));

    const outside = await cms.app.request(endpoint('https://example.com/2026/09/hello/'));
    assert.equal(outside.status, 404);
  });

  it('embeds a static homepage at / and not the posts page that is a listing', async () => {
    const cms = await site({ homepage: 'welcome', postsPage: 'blog' });
    const home = await embed(cms, 'https://blog.example/');
    assert.equal(home['title'], 'Welcome');
    assert.ok(String(home['html']).includes('href="https://blog.example/"'));

    assert.equal((await cms.app.request(endpoint('https://blog.example/blog/'))).status, 404);
  });
});

/** The embed view's path for `url`. */
function embedView(url: string): string {
  return `/_geekity/embed?${new URLSearchParams({ url }).toString()}`;
}

/** The embed view of `url`, after checking it is served as a page. */
async function embedViewOf(cms: Cms, url: string): Promise<{ response: Response; html: string }> {
  const response = await cms.app.request(embedView(url));
  assert.equal(response.status, 200, url);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  return { response, html: await response.text() };
}

/** The contents of the one inline element `tag` in `html`. */
function inline(html: string, tag: string): string {
  const found = [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))];
  assert.equal(found.length, 1, `the page has ${String(found.length)} <${tag}> elements`);
  return found[0]?.[1] ?? '';
}

function sha256(contents: string): string {
  return `'sha256-${createHash('sha256').update(contents, 'utf8').digest('base64')}'`;
}

/** The response's policy as a map of directive to its sources. */
function directives(response: Response): Map<string, string> {
  const policy = response.headers.get('content-security-policy') ?? '';
  return new Map(
    policy.split(';').map((part) => {
      const [name = '', ...sources] = part.trim().split(/\s+/);
      return [name, sources.join(' ')];
    }),
  );
}

function assertNotFramable(response: Response, what: string): void {
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN', what);
  assert.equal(directives(response).get('frame-ancestors'), "'self'", what);
}

describe('the embed view (TASK-208)', () => {
  it('is a page of the oEmbed card alone, for a post, a page and a note', async () => {
    const cms = await site();
    for (const url of [
      'https://blog.example/2026/09/hello/',
      'https://blog.example/about/',
      'https://blog.example/2026/09/note/',
    ]) {
      const { html } = await embedViewOf(cms, url);
      const card = String((await embed(cms, url))['html']).replace(/<iframe[\s\S]*$/, '');

      assert.match(html, /^<!doctype html>\n<html lang="en">/, url);
      assert.ok(html.includes('<meta charset="utf-8">'), `${url}: no charset`);
      assert.ok(html.includes('<meta name="viewport"'), `${url}: no viewport`);
      assert.match(html, /<title>[^<]+<\/title>/, url);
      assert.ok(html.includes(card), `${url}: not the oEmbed card`);
      assert.doesNotMatch(html, /<link|<img|src=/, `${url}: loads something`);
    }
  });

  it('answers 404, framed by nobody else, for anything oEmbed would not embed', async () => {
    const cms = await site();
    for (const url of [
      'https://blog.example/2026/09/secret/',
      'https://blog.example/2026/12/later/',
      'https://elsewhere.example/2026/09/hello/',
      'https://blog.example/tag/words/',
      'https://blog.example/page/2/',
      '',
    ]) {
      const response = await cms.app.request(embedView(url));
      assert.equal(response.status, 404, url);
      const body = await response.text();
      assert.ok(!body.includes('Secret') && !body.includes('Tomorrow'), url);
      assertNotFramable(response, url);
    }
  });

  it('may be framed by any site, loading only its own inline style and script', async () => {
    const cms = await site({}, { securityHeaders: { 'X-Frame-Options': 'DENY' } });
    const { response, html } = await embedViewOf(cms, 'https://blog.example/2026/09/hello/');
    const policy = directives(response);

    assert.equal(response.headers.get('x-frame-options'), null, 'framing is still refused');
    assert.equal(policy.get('frame-ancestors'), '*');
    assert.equal(policy.get('default-src'), "'none'");
    assert.equal(policy.get('style-src'), sha256(inline(html, 'style')));
    assert.equal(policy.get('script-src'), sha256(inline(html, 'script')));
    assert.equal(policy.get('img-src'), undefined, 'the card has no image to allow');
    assert.equal(policy.get('base-uri'), "'none'");
    assert.equal(policy.get('form-action'), "'none'");
  });

  it('leaves every other response framable by the site alone', async () => {
    const cms = await site({}, { securityHeaders: { 'X-Frame-Options': 'DENY' } });
    const plain = await site();
    const post = 'https://blog.example/2026/09/hello/';

    assertNotFramable(await plain.app.request('/2026/09/hello/'), 'a post');
    assertNotFramable(await plain.app.request(endpoint(post)), 'the oEmbed endpoint');
    assertNotFramable(await plain.app.request('/no-such-page/'), 'a 404');
    assertNotFramable(await plain.app.request('/admin/login'), 'an admin page');
    assert.equal(
      (await cms.app.request('/2026/09/hello/')).headers.get('x-frame-options'),
      'DENY',
      "a site's own X-Frame-Options is kept everywhere else",
    );
  });

  it('is the same page for a signed-in admin as for anyone', async () => {
    const cms = await site();
    const admin = await signIn(cms, { username: 'ada', password: 'a password of hers' });
    const url = 'https://blog.example/2026/09/hello/';
    const signedInPost = await (await admin.get('/2026/09/hello/')).text();
    assert.ok(signedInPost.includes('geekity-admin-bar'), 'the admin is not signed in');

    const anonymous = await cms.app.request(embedView(url));
    const signedIn = await admin.get(embedView(url));

    assert.equal(await signedIn.text(), await anonymous.text());
    assert.equal(signedIn.headers.get('etag'), anonymous.headers.get('etag'));
    assert.equal(signedIn.headers.get('set-cookie'), null);
  });

  it('is what the oEmbed html frames, after the card, hidden and sandboxed', async () => {
    const cms = await site({}, { baseUrl: 'https://example.com/blog' });
    const url = 'https://example.com/blog/2026/09/hello/';
    const html = String((await embed(cms, url))['html']);
    const frame = /<iframe ([^>]*)><\/iframe>$/.exec(html)?.[1] ?? '';
    const attribute = (name: string): string | undefined =>
      new RegExp(`(?:^| )${name}="([^"]*)"`).exec(frame)?.[1];

    assert.ok(html.startsWith('<blockquote'), 'the card no longer comes first');
    assert.equal(attribute('sandbox'), 'allow-scripts');
    assert.equal(attribute('security'), 'restricted');
    assert.equal(attribute('width'), '600');
    assert.equal(attribute('height'), '338');
    assert.equal(attribute('title'), 'Fish &amp; &lt;b&gt;chips&lt;/b&gt; &quot;to go&quot;');
    assert.equal(attribute('frameborder'), '0');
    assert.equal(attribute('scrolling'), 'no');
    assert.equal(attribute('style'), 'position: absolute; visibility: hidden;');

    const src = new URL((attribute('src') ?? '').replaceAll('&amp;', '&'));
    assert.equal(src.origin, 'https://example.com');
    assert.equal(src.pathname, '/blog/_geekity/embed');
    assert.equal(src.searchParams.get('url'), url);
    const framed = await embedViewOf(cms, url);
    assert.ok(framed.html.includes(html.replace(/<iframe[\s\S]*$/, '')), 'a different card');
  });

  it('answers a repeat request with 304', async () => {
    const cms = await site();
    const at = embedView('https://blog.example/2026/09/hello/');
    const etag = (await cms.app.request(at)).headers.get('etag');
    assert.ok(etag !== null, 'the page carries no validator');
    const again = await cms.app.request(at, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304);
    assert.equal(again.headers.get('x-frame-options'), null);
  });
});

/** A message the embed script posted to the framing page, and to which origin. */
interface Posted {
  data: unknown;
  origin: string;
}

/**
 * The embed page's script run against a stand-in for the frame it lives in,
 * at `hash`, with what it posts to its parent and the events it listens for.
 */
function framedScript(script: string, hash: string) {
  const posted: Posted[] = [];
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const listen = (type: string, listener: (event: unknown) => void): void => {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  };
  class Element {
    constructor(readonly href?: string) {}
    closest(): Element | null {
      return this.href === undefined ? null : this;
    }
  }
  const parent = {
    // Through JSON, as a structured clone would, so it compares across realms.
    postMessage: (data: unknown, origin: string) =>
      posted.push({ data: JSON.parse(JSON.stringify(data)) as unknown, origin }),
  };
  vm.runInNewContext(script, {
    window: { parent },
    location: { hash },
    addEventListener: listen,
    Element,
    document: {
      documentElement: { getBoundingClientRect: () => ({ height: 211.4 }) },
      addEventListener: listen,
    },
  });

  function fire(type: string, event: unknown): void {
    for (const listener of listeners.get(type) ?? []) listener(event);
  }
  function click(href?: string): boolean {
    let prevented = false;
    fire('click', {
      target: new Element(href),
      preventDefault: () => (prevented = true),
    });
    return prevented;
  }
  return { posted, fire, click };
}

describe("the embed view's side of WordPress's embed protocol (TASK-208)", () => {
  async function script(): Promise<string> {
    const { html } = await embedViewOf(await site(), 'https://blog.example/2026/09/hello/');
    return inline(html, 'script');
  }

  it('tells the host its height on load, on resize and when the host is ready', async () => {
    const frame = framedScript(await script(), '#?secret=Ab12Cd34Ef');
    const height = { data: { message: 'height', value: 212, secret: 'Ab12Cd34Ef' }, origin: '*' };

    frame.fire('load', {});
    frame.fire('resize', {});
    frame.fire('message', { data: { message: 'ready', secret: 'Ab12Cd34Ef' } });
    frame.fire('message', { data: { message: 'ready', secret: 'someone-else' } });

    assert.deepEqual(frame.posted, [height, height, height]);
  });

  it('hands a link to the host instead of following it', async () => {
    const frame = framedScript(await script(), '#?secret=Ab12Cd34Ef');

    assert.equal(frame.click('https://blog.example/2026/09/hello/'), true, 'the link was followed');
    assert.equal(frame.click(), false, 'a click off any link was stopped');
    assert.deepEqual(frame.posted, [
      {
        data: {
          message: 'link',
          value: 'https://blog.example/2026/09/hello/',
          secret: 'Ab12Cd34Ef',
        },
        origin: '*',
      },
    ]);
  });

  it('does nothing opened directly, so its links are ordinary links', async () => {
    const frame = framedScript(await script(), '');

    frame.fire('load', {});
    assert.equal(frame.click('https://blog.example/2026/09/hello/'), false);
    assert.deepEqual(frame.posted, []);
  });
});
