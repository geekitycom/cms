import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import { sandbox } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import type { TestUser } from '../admin/__testing__/users.ts';
import type { Cms } from '../index.ts';
import { shared } from './__testing__/shared.ts';

const box = sandbox();
after(() => box.cleanup());

const ADA: TestUser = {
  username: 'ada',
  email: 'ada@private.example',
  profile: {
    displayName: 'Ada Lovelace',
    bio: 'Writes about [engines](/tags/engines/), numbers; and poetry.',
    avatar: '/uploads/2026/09/ada.png',
    jobTitle: 'Analyst',
    location: 'London',
    links: [
      { label: 'Mastodon', href: 'https://example.social/@ada' },
      { label: 'Notes', href: '/notes/' },
    ],
  },
};

const CONTACT_PAGE =
  '---\ntitle: Say hello\npermalink: /contact/\ncontact: true\n---\n\nWrite to me.\n';

async function site(options: {
  siteJson: Record<string, unknown>;
  users?: readonly TestUser[];
  files?: Record<string, string | Buffer>;
}): Promise<Cms> {
  const contentDir = await box.dir('geekity-social-content-');
  const dataDir = await box.dir('geekity-social-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify(options.siteJson),
    'utf8',
  );
  for (const [name, contents] of Object.entries(options.files ?? {})) {
    await mkdir(path.dirname(path.join(contentDir, name)), { recursive: true });
    await writeFile(path.join(contentDir, name), contents);
  }
  if (options.users !== undefined) writeUsers(dataDir, options.users);
  return box.open({ contentDir, dataDir, baseUrl: 'https://blog.example' });
}

const sharedSite = shared(site);

function siteOfAda(): Promise<Cms> {
  return sharedSite({
    siteJson: { title: 'Engines', tagline: 'Notes: on engines', author: 'ada' },
    users: [ADA],
    files: { 'pages/contact.md': CONTACT_PAGE },
  });
}

function siteOfNobody(): Promise<Cms> {
  return sharedSite({ siteJson: { title: 'Engines' } });
}

interface VcardProperty {
  group: string;
  name: string;
  params: Record<string, string>;
  value: string;
}

function property(name: string, value: string, params: Record<string, string> = {}) {
  return { group: '', name, params, value };
}

function parseVcard(text: string): VcardProperty[] {
  return text
    .replace(/\r\n /g, '')
    .split('\r\n')
    .filter((line) => line !== '')
    .map((line) => {
      const head = /^(?:([\w-]+)\.)?([\w-]+)((?:;[\w-]+=(?:"[^"]*"|[^;:"]*))*):/.exec(line);
      assert.ok(head !== null, `${line} is a content line`);
      const [whole, group = '', name = '', rawParams = ''] = head;
      const params = Object.fromEntries(
        [...rawParams.matchAll(/;([\w-]+)=("[^"]*"|[^;]*)/g)].map(([, key = '', raw = '']) => [
          key,
          raw.replace(/^"(.*)"$/, '$1'),
        ]),
      );
      const value = line
        .slice(whole.length)
        .replace(/\\([\\,;nN])/g, (_, escaped: string) =>
          escaped.toLowerCase() === 'n' ? '\n' : escaped,
        );
      return { group, name, params, value };
    });
}

function values(properties: readonly VcardProperty[], name: string): string[] {
  return properties.filter((line) => line.name === name).map((line) => line.value);
}

function socialProfiles(card: readonly VcardProperty[]) {
  return card
    .filter((line) => line.name === 'X-SOCIALPROFILE')
    .map((line) => ({ type: line.params.type, user: line.params['x-user'], uri: line.value }));
}

function labelledUrls(card: readonly VcardProperty[]) {
  return card
    .filter((line) => line.name === 'URL' && line.group !== '')
    .map((line) => ({
      label: card.find((other) => other.group === line.group && other.name === 'X-ABLabel')?.value,
      url: line.value,
    }));
}

async function get(cms: Cms, pathname: string, headers: Record<string, string> = {}) {
  const response = await cms.app.request(pathname, { headers });
  return { response, body: await response.text() };
}

describe('/.well-known/about.md', () => {
  it('is the site author’s profile as Markdown, every URL absolute', async () => {
    const { response, body } = await get(await siteOfAda(), '/.well-known/about.md', {
      accept: 'text/markdown',
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.match(body, /^---\nsummary: 'Notes: on engines'\n---\n/, 'the tagline is the summary');
    assert.match(body, /^### About Ada Lovelace$/m);
    assert.match(
      body,
      /^!\[Ada Lovelace\]\(https:\/\/blog\.example\/uploads\/2026\/09\/ada\.png\)$/m,
    );
    assert.match(body, /^Analyst · London$/m);
    assert.match(
      body,
      /^Writes about \[engines\]\(https:\/\/blog\.example\/tags\/engines\/\), numbers; and poetry\.$/m,
    );
    assert.match(body, /^- \[Website\]\(https:\/\/blog\.example\/\)$/m);
    assert.match(body, /^- \[Mastodon\]\(https:\/\/example\.social\/@ada\)$/m);
    assert.match(body, /^- \[Notes\]\(https:\/\/blog\.example\/notes\/\)$/m);
    assert.match(body, /^- \[Contact\]\(https:\/\/blog\.example\/contact\/\)$/m);
    assert.doesNotMatch(body, /ada@private\.example|mailto:/, 'no email address');
  });

  it('describes a site with no author by its name and address', async () => {
    const { response, body } = await get(await siteOfNobody(), '/.well-known/about.md');

    assert.equal(response.status, 200);
    assert.equal(body, '### About Engines\n\n- [Website](https://blog.example/)\n');
  });
});

describe('/.well-known/contact.vcf', () => {
  it('is a vCard 3.0 of the site author for Apple Contacts, with no email address', async () => {
    const { response, body } = await get(await siteOfAda(), '/.well-known/contact.vcf');
    const card = parseVcard(body);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/vcard; charset=utf-8');
    assert.deepEqual(card[0], property('BEGIN', 'VCARD'));
    assert.deepEqual(card[1], property('VERSION', '3.0'));
    assert.deepEqual(card.at(-1), property('END', 'VCARD'));
    assert.deepEqual(values(card, 'N'), [';;;;']);
    assert.deepEqual(values(card, 'FN'), ['Ada Lovelace']);
    assert.deepEqual(values(card, 'NICKNAME'), ['@blog.example']);
    assert.deepEqual(values(card, 'TITLE'), ['Analyst']);
    assert.deepEqual(values(card, 'NOTE'), ['Writes about engines, numbers; and poetry.']);
    assert.deepEqual(values(card, 'PHOTO'), [], 'no photo when the avatar file is not there');
    assert.deepEqual(
      card.filter((line) => line.name === 'URL' && line.group === ''),
      [property('URL', 'https://blog.example/', { type: 'pref' })],
    );
    assert.deepEqual(socialProfiles(card), [
      { type: 'Mastodon', user: '@ada@example.social', uri: 'https://example.social/@ada' },
    ]);
    assert.deepEqual(labelledUrls(card), [
      { label: 'Notes', url: 'https://blog.example/notes/' },
      { label: 'Contact form', url: 'https://blog.example/contact/' },
    ]);
    for (const name of ['KIND', 'CONTACT-URI', 'EMAIL']) assert.deepEqual(values(card, name), []);
    assert.doesNotMatch(body, /ada@private\.example/);
  });

  it('lists accounts on services Apple knows as social profiles and labels the other links', async () => {
    const cms = await site({
      siteJson: { title: 'Andrew', author: 'andrew' },
      users: [
        {
          username: 'andrew',
          profile: {
            displayName: 'Andrew',
            links: [
              { label: 'X', href: 'https://x.com/andrewshell' },
              { label: 'Twitter', href: 'https://twitter.com/@ashell' },
              { label: 'Mastodon', href: 'https://indieweb.social/@andrewshell' },
              { label: 'GitHub', href: 'https://github.com/andrewshell' },
              { label: 'LinkedIn', href: 'https://www.linkedin.com/in/andrew-shell/' },
              { label: 'Bluesky', href: 'https://bsky.app/profile/andrewshell.org' },
              { label: 'Gravatar', href: 'https://gravatar.com/andrewshell' },
              { label: 'A repository', href: 'https://github.com/andrewshell/cms' },
            ],
          },
        },
      ],
    });

    const card = parseVcard((await get(cms, '/.well-known/contact.vcf')).body);

    assert.deepEqual(socialProfiles(card), [
      { type: 'twitter', user: 'andrewshell', uri: 'https://x.com/andrewshell' },
      { type: 'twitter', user: 'ashell', uri: 'https://twitter.com/@ashell' },
      {
        type: 'Mastodon',
        user: '@andrewshell@indieweb.social',
        uri: 'https://indieweb.social/@andrewshell',
      },
      { type: 'GitHub', user: 'andrewshell', uri: 'https://github.com/andrewshell' },
      {
        type: 'linkedin',
        user: 'andrew-shell',
        uri: 'https://www.linkedin.com/in/andrew-shell/',
      },
      { type: 'Bluesky', user: 'andrewshell.org', uri: 'https://bsky.app/profile/andrewshell.org' },
    ]);
    assert.deepEqual(labelledUrls(card), [
      { label: 'Gravatar', url: 'https://gravatar.com/andrewshell' },
      { label: 'A repository', url: 'https://github.com/andrewshell/cms' },
    ]);
  });

  it('embeds a derived copy of an uploaded JPEG avatar, a few hundred pixels wide', async () => {
    const avatar = await sharp({
      create: { width: 1000, height: 800, channels: 3, background: { r: 200, g: 90, b: 40 } },
    })
      .jpeg()
      .toBuffer();
    const cms = await site({
      siteJson: { title: 'Engines', author: 'ada' },
      users: [{ username: 'ada', profile: { displayName: 'Ada', avatar: '/uploads/ada.jpg' } }],
      files: { 'uploads/ada.jpg': avatar },
    });

    const card = parseVcard((await get(cms, '/.well-known/contact.vcf')).body);
    const [photo] = card.filter((line) => line.name === 'PHOTO');

    assert.deepEqual(photo?.params, { ENCODING: 'b', TYPE: 'JPEG' });
    const embedded = await sharp(Buffer.from(photo.value, 'base64')).metadata();
    assert.equal(embedded.format, 'jpeg');
    assert.equal(embedded.width, 320);
  });

  it('embeds a small PNG avatar as the PNG it is', async () => {
    const avatar = await sharp({
      create: { width: 120, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const cms = await site({
      siteJson: { title: 'Engines', author: 'ada' },
      users: [{ username: 'ada', profile: { displayName: 'Ada', avatar: '/uploads/ada.png' } }],
      files: { 'uploads/ada.png': avatar },
    });

    const card = parseVcard((await get(cms, '/.well-known/contact.vcf')).body);
    const [photo] = card.filter((line) => line.name === 'PHOTO');

    assert.deepEqual(photo?.params, { ENCODING: 'b', TYPE: 'PNG' });
    assert.equal((await sharp(Buffer.from(photo.value, 'base64')).metadata()).width, 120);
  });

  it('leaves the photo out when the avatar is somewhere else', async () => {
    const cms = await site({
      siteJson: { title: 'Engines', author: 'ada' },
      users: [
        {
          username: 'ada',
          profile: { displayName: 'Ada', avatar: 'https://elsewhere.example/ada.jpg' },
        },
      ],
    });

    const card = parseVcard((await get(cms, '/.well-known/contact.vcf')).body);

    assert.deepEqual(values(card, 'PHOTO'), []);
  });

  it('escapes TEXT values, ends every line with CRLF and folds at 75 octets', async () => {
    const bio = `Ünïcödé, semicolons; backslashes \\ and a long tail ${'é'.repeat(80)}.`;
    const cms = await site({
      siteJson: { title: 'Engines', author: 'ada' },
      users: [{ username: 'ada', profile: { displayName: 'Ada, Countess; of Lovelace', bio } }],
    });

    const { body } = await get(cms, '/.well-known/contact.vcf');
    const card = parseVcard(body);

    assert.ok(body.endsWith('\r\n'));
    assert.doesNotMatch(body.replace(/\r\n/g, ''), /[\r\n]/, 'no bare CR or LF');
    for (const line of body.split('\r\n')) {
      assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `${line} is over 75 octets`);
    }
    assert.match(body, /^FN:Ada\\, Countess\\; of Lovelace\r\n/m);
    assert.match(body, /\r\n /, 'the long NOTE is folded');
    assert.deepEqual(values(card, 'FN'), ['Ada, Countess; of Lovelace']);
    assert.deepEqual(values(card, 'NOTE'), [bio]);
  });

  it('describes a site with no author as a company card with its name and address', async () => {
    const { response, body } = await get(await siteOfNobody(), '/.well-known/contact.vcf');
    const card = parseVcard(body);

    assert.equal(response.status, 200);
    assert.deepEqual(values(card, 'VERSION'), ['3.0']);
    assert.deepEqual(values(card, 'N'), [';;;;']);
    assert.deepEqual(values(card, 'FN'), ['Engines']);
    assert.deepEqual(values(card, 'ORG'), ['Engines']);
    assert.deepEqual(values(card, 'X-ABShowAs'), ['COMPANY']);
    assert.deepEqual(values(card, 'NICKNAME'), ['@blog.example']);
    assert.deepEqual(values(card, 'URL'), ['https://blog.example/']);
    assert.deepEqual(values(card, 'PHOTO'), []);
    assert.deepEqual(labelledUrls(card), []);
  });
});

describe('both profile files', () => {
  for (const pathname of ['/.well-known/about.md', '/.well-known/contact.vcf']) {
    it(`${pathname} may be read from any origin and is validated`, async () => {
      const cms = await siteOfAda();

      const first = await get(cms, pathname);
      const etag = first.response.headers.get('etag');
      assert.equal(first.response.headers.get('access-control-allow-origin'), '*');
      assert.ok(etag !== null, 'an ETag');

      const again = await get(cms, pathname, { 'if-none-match': etag });
      assert.equal(again.response.status, 304);
      assert.equal(again.body, '');
      assert.equal(again.response.headers.get('etag'), etag);
      assert.equal(again.response.headers.get('access-control-allow-origin'), '*');

      const stale = await get(cms, pathname, { 'if-none-match': '"something-else"' });
      assert.equal(stale.response.status, 200);
    });
  }

  it('give the two files different ETags', async () => {
    const cms = await siteOfAda();
    const about = await get(cms, '/.well-known/about.md');
    const card = await get(cms, '/.well-known/contact.vcf');

    assert.notEqual(about.response.headers.get('etag'), card.response.headers.get('etag'));
  });
});

describe('SocialSpec feed addresses', () => {
  for (const [pathname, target] of [
    ['/feed.xml', '/feed/'],
    ['/feed.json', '/feed/json/'],
  ] as const) {
    it(`${pathname} redirects permanently to ${target}`, async () => {
      const cms = await siteOfNobody();

      const { response } = await get(cms, pathname);

      assert.equal(response.status, 301);
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      assert.equal(
        new URL(response.headers.get('location') ?? '', 'https://blog.example').pathname,
        target,
      );
      assert.equal((await get(cms, target)).response.status, 200);
    });
  }
});
