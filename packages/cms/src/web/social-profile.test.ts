import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

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
  files?: Record<string, string>;
}): Promise<Cms> {
  const contentDir = await box.dir('geekity-social-content-');
  const dataDir = await box.dir('geekity-social-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify(options.siteJson),
    'utf8',
  );
  for (const [name, text] of Object.entries(options.files ?? {})) {
    await mkdir(path.dirname(path.join(contentDir, name)), { recursive: true });
    await writeFile(path.join(contentDir, name), text, 'utf8');
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
  name: string;
  params: string;
  value: string;
}

function parseVcard(text: string): VcardProperty[] {
  return text
    .replace(/\r\n /g, '')
    .split('\r\n')
    .filter((line) => line !== '')
    .map((line) => {
      const colon = line.indexOf(':');
      const [name = '', ...params] = line.slice(0, colon).split(';');
      const value = line
        .slice(colon + 1)
        .replace(/\\([\\,;nN])/g, (_, escaped: string) =>
          escaped.toLowerCase() === 'n' ? '\n' : escaped,
        );
      return { name, params: params.join(';'), value };
    });
}

function values(properties: readonly VcardProperty[], name: string): string[] {
  return properties.filter((property) => property.name === name).map((property) => property.value);
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
  it('is a vCard 4.0 of the site author, with no email address', async () => {
    const { response, body } = await get(await siteOfAda(), '/.well-known/contact.vcf');
    const card = parseVcard(body);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/vcard; charset=utf-8');
    assert.deepEqual(card[0], { name: 'BEGIN', params: '', value: 'VCARD' });
    assert.deepEqual(card[1], { name: 'VERSION', params: '', value: '4.0' });
    assert.deepEqual(card.at(-1), { name: 'END', params: '', value: 'VCARD' });
    assert.deepEqual(values(card, 'KIND'), ['individual']);
    assert.deepEqual(values(card, 'FN'), ['Ada Lovelace']);
    assert.deepEqual(values(card, 'TITLE'), ['Analyst']);
    assert.deepEqual(values(card, 'NOTE'), ['Writes about engines, numbers; and poetry.']);
    assert.deepEqual(values(card, 'PHOTO'), ['https://blog.example/uploads/2026/09/ada.png']);
    assert.deepEqual(
      card.filter((property) => property.name === 'URL'),
      [
        { name: 'URL', params: 'PREF=1', value: 'https://blog.example/' },
        { name: 'URL', params: '', value: 'https://example.social/@ada' },
        { name: 'URL', params: '', value: 'https://blog.example/notes/' },
      ],
    );
    assert.deepEqual(values(card, 'CONTACT-URI'), ['https://blog.example/contact/']);
    assert.deepEqual(values(card, 'EMAIL'), []);
    assert.doesNotMatch(body, /ada@private\.example/);
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

  it('describes a site with no author by its name and address, and no contact page', async () => {
    const { response, body } = await get(await siteOfNobody(), '/.well-known/contact.vcf');
    const card = parseVcard(body);

    assert.equal(response.status, 200);
    assert.deepEqual(values(card, 'KIND'), ['org']);
    assert.deepEqual(values(card, 'FN'), ['Engines']);
    assert.deepEqual(values(card, 'URL'), ['https://blog.example/']);
    assert.deepEqual(values(card, 'PHOTO'), []);
    assert.deepEqual(values(card, 'CONTACT-URI'), []);
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
