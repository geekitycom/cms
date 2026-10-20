import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';

import { classifyFiles, createCms, createMemoryMailProvider, createUser } from '@geekity/cms';
import type { Cms, DataFileDeclaration, MemoryMailProvider, OutgoingMail } from '@geekity/cms';
import { pluginDataFolder, pluginSite } from '@geekity/cms/testing';
import llm from '@geekity/plugin-llm';
import postSummary from '@geekity/plugin-post-summary';
import tagSuggest from '@geekity/plugin-tag-suggest';

import { fakeProvider, replying } from '../../plugin-llm/test/provider.ts';
import type { FakeProvider } from '../../plugin-llm/test/provider.ts';
import { fakeTagsPub } from '../../plugin-tag-suggest/test/tags-pub.ts';
import type { FakeTagsPub } from '../../plugin-tag-suggest/test/tags-pub.ts';
import { contentImportCommand } from '../src/content-command.ts';
import wordpress, { importWordPressActor, wordPressRecords } from '../src/index.ts';
import { wxr } from './wxr.ts';

/**
 * It lives here because core's tests may not name this plugin, and the
 * content import is not one of the plugin's exports.
 */

const BASE = 'https://blog.example';
const ADA = { username: 'ada', password: 'correct horse battery', email: 'ada@blog.example' };
const APP = 'https://app.example/';
const CALLBACK = `${APP}callback`;
const AVATAR = 'https://grace.example/avatar.png';
const LLM = '@geekity/plugin-llm';
const TAGS = '@geekity/plugin-tag-suggest';
const GONE = '@acme/plugin-gone';

const dirs: string[] = [];
let provider: FakeProvider;
let tagsPub: FakeTagsPub;
let restoreFetch: () => void;

before(async () => {
  provider = await fakeProvider();
  tagsPub = await fakeTagsPub();
  const passOn = globalThis.fetch;
  const web: Record<string, () => Response> = {
    [APP]: () =>
      new Response('<div class="h-app"><a class="u-url p-name" href="/">Quill</a></div>', {
        headers: { 'content-type': 'text/html' },
      }),
    [AVATAR]: () => new Response(png(64, 64), { headers: { 'content-type': 'image/png' } }),
  };
  globalThis.fetch = (input, init) => {
    const answer = web[new Request(input, init).url];
    return answer === undefined ? passOn(input, init) : Promise.resolve(answer());
  };
  restoreFetch = () => {
    globalThis.fetch = passOn;
  };
});

after(async () => {
  restoreFetch();
  await provider.close();
  await tagsPub.close();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function write(root: string, relative: string, contents: string): void {
  const file = path.join(root, ...relative.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

interface Admin {
  get(url: string): Promise<Response>;
  post(url: string, fields: Record<string, string> | [string, string][]): Promise<Response>;
  token(url?: string): Promise<string>;
}

function csrfIn(html: string): string {
  return /name="csrf_token"\s+value="([^"]+)"/.exec(html)?.[1] ?? '';
}

async function signIn(cms: Cms): Promise<Admin> {
  let cookie = '';
  const remember = (response: Response): Response => {
    const set = response.headers.get('set-cookie');
    if (set !== null) cookie = set.split(';')[0] ?? '';
    return response;
  };
  const send = async (url: string, fields: Record<string, string> | [string, string][]) =>
    remember(
      await cms.app.request(url, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      }),
    );
  const login = await remember(await cms.app.request('/admin/login')).text();
  const answer = await send('/admin/login', {
    csrf_token: csrfIn(login),
    username: ADA.username,
    password: ADA.password,
  });
  assert.equal(answer.status, 303, 'ada signed in');

  const admin: Admin = {
    get: async (url) => remember(await cms.app.request(url, { headers: { cookie } })),
    post: async (url, fields) =>
      send(
        url,
        Array.isArray(fields)
          ? [['csrf_token', await admin.token()], ...fields]
          : { csrf_token: await admin.token(), ...fields },
      ),
    token: async (url = '/admin/posts/new') => csrfIn(await (await admin.get(url)).text()),
  };
  return admin;
}

function form(fields: Record<string, string>, headers: Record<string, string> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  };
}

interface Census {
  cms: Cms;
  admin: Admin;
  mail: MemoryMailProvider;
  dataDir: string;
}

async function bootSite(): Promise<Census> {
  const contentDir = await temporaryDir('geekity-census-content-');
  const dataDir = await temporaryDir('geekity-census-data-');
  const pluginsDir = await temporaryDir('geekity-census-plugins-');
  const today = new Date().toISOString();
  write(
    contentDir,
    '_data/site.json',
    JSON.stringify({
      title: 'Census',
      author: ADA.username,
      notifyServer: '',
      plugins: Object.fromEntries(
        [llm, postSummary, tagSuggest, wordpress].map((plugin) => [plugin.name, { enabled: true }]),
      ),
    }),
  );
  write(
    contentDir,
    'posts/hello-world.md',
    `---\ntitle: Hello world\ndate: '${today}'\npermalink: /hello-world/\n---\n\nWords.\n`,
  );
  write(
    contentDir,
    'pages/contact.md',
    '---\ntitle: Contact\ncontact: true\npermalink: /contact/\n---\n\nWrite.\n',
  );
  write(
    contentDir,
    'posts/seen.md',
    `---\ntitle: Seen\ndate: '${today}'\npermalink: /seen/\n---\n\nSeen.\n`,
  );
  write(
    contentDir,
    '_data/comments/seen.json',
    JSON.stringify({
      post: '/seen/',
      comments: [
        {
          id: '0000000000000001',
          source: 'webmention',
          kind: 'mention',
          status: 'approved',
          author: { name: 'Grace', url: 'https://grace.example/', email: null, avatar: AVATAR },
          content: { markdown: 'Wrote about this', html: '<p>Wrote about this</p>' },
          submitted: today,
          addressHash: null,
          inReplyTo: null,
          url: 'https://grace.example/2026/about-that/',
          notify: false,
        },
      ],
    }),
  );
  write(
    pluginsDir,
    `${GONE}/plugin.json`,
    JSON.stringify({ name: GONE, version: '1.0.0', main: 'index.js' }),
  );
  await createUser({ dataDir, ...ADA });
  await createUser({ dataDir, username: 'andrew', password: 'another horse battery' });

  const mail = createMemoryMailProvider();
  const cms = createCms({
    dataDir,
    contentDir,
    pluginsDir,
    baseUrl: BASE,
    watch: false,
    trustProxy: true,
    plugins: [llm, postSummary, tagSuggest, wordpress],
    federation: { allowPrivateAddress: true },
    hostLookup: () => Promise.resolve(['203.0.113.7']),
    mail: { provider: mail, backoffMs: () => 0, logger: { info: () => {}, warn: () => {} } },
  });
  await cms.sync();
  return { cms, admin: await signIn(cms), mail, dataDir };
}

function linkFor(message: OutgoingMail | undefined, action: string): URL {
  const found = (message?.text.match(/https:\/\/blog\.example\/_geekity\/\S+/g) ?? [])
    .map((link) => new URL(link))
    .find(
      (link) => link.pathname.endsWith(`/${action}`) || link.searchParams.get('action') === action,
    );
  assert.ok(found !== undefined, `no ${action} link in:\n${message?.text ?? '(no message)'}`);
  return found;
}

async function settle(cms: Cms): Promise<void> {
  await cms.notifications.settled();
  await cms.mail.settled();
}

async function confirm(cms: Cms, link: URL): Promise<void> {
  const answer = await cms.app.request(link.pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: link.searchParams.toString(),
  });
  assert.ok(answer.status < 400, `${link.pathname} answered ${String(answer.status)}`);
  await settle(cms);
}

let commenters = 0;

async function comment(
  site: Census,
  fields: Record<string, string>,
): Promise<OutgoingMail | undefined> {
  commenters += 1;
  site.mail.clear();
  const answer = await site.cms.app.request(
    '/_geekity/comments',
    form(
      {
        post: 'hello-world',
        url: '',
        in_reply_to: '',
        website: '',
        loaded: String(Date.now() - 60_000),
        ...fields,
      },
      { 'x-forwarded-for': `203.0.113.${String(commenters)}` },
    ),
  );
  assert.equal(answer.status, 303, `the comment by ${fields['name'] ?? ''} was taken`);
  await settle(site.cms);
  return site.mail.sent.find((message) => message.to.some((to) => to.address === ADA.email));
}

async function discuss(site: Census): Promise<void> {
  const { cms, admin } = site;
  const grace = await comment(site, {
    name: 'Grace Hopper',
    email: 'grace@example.com',
    body: 'A thought.',
    notify: '1',
  });
  await confirm(cms, linkFor(grace, 'approve'));
  const parent = pluginSite({ admin: cms.admin, config: cms.config }).comments('/hello-world/')
    .comments[0]?.id;
  assert.ok(parent !== undefined, 'the comment was kept');

  const alan = await comment(site, {
    name: 'Alan Turing',
    email: 'alan@example.com',
    body: 'I agree.',
    in_reply_to: parent,
  });
  site.mail.clear();
  await confirm(cms, linkFor(alan, 'approve'));
  const told = site.mail.sent.find((message) =>
    message.to.some((to) => to.address === 'grace@example.com'),
  );
  await confirm(cms, linkFor(told, 'unsubscribe'));

  const ada = /\/admin\/users\/(\d+)/.exec(await (await admin.get('/admin/users')).text())?.[1];
  assert.ok(ada !== undefined, 'the users screen links to ada');
  const hourly = await admin.post('/admin/users/notifications/mode', {
    user_id: ada,
    event: 'comments',
    mode: 'hourly',
  });
  assert.equal(hourly.status, 303);
  await comment(site, { name: 'Pat Doe', email: 'pat@example.com', body: 'Queued.' });
  assert.ok((await cms.digests.run()) > 0, 'a digest went');
  await settle(cms);
}

async function contact(cms: Cms): Promise<void> {
  const answer = await cms.app.request(
    '/_geekity/contact',
    form(
      {
        page: 'contact',
        name: 'Grace Hopper',
        email: 'grace@example.com',
        subject: 'Hello',
        message: 'A message.',
        website: '',
        loaded: String(Date.now() - 60_000),
      },
      { 'x-forwarded-for': '203.0.113.99' },
    ),
  );
  assert.equal(answer.status, 303, 'the contact message was taken');
}

async function indieAuthToken(cms: Cms, admin: Admin): Promise<string> {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: APP,
    redirect_uri: CALLBACK,
    state: 'state-1',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    scope: 'create media',
    me: `${BASE}/`,
  });
  const consent = await (await admin.get(`/admin/indieauth/consent?${query.toString()}`)).text();
  const approved = await admin.post('/admin/indieauth/consent', [
    ['request', /name="request" value="([^"]+)"/.exec(consent)?.[1] ?? ''],
    ['decision', 'approve'],
    ['scope', 'create'],
    ['scope', 'media'],
  ]);
  const code = new URL(approved.headers.get('location') ?? '', BASE).searchParams.get('code');
  assert.ok(code !== null, 'the approval carried a code');
  const redeemed = await cms.app.request(
    '/_geekity/indieauth/token',
    form(
      {
        grant_type: 'authorization_code',
        code,
        client_id: APP,
        redirect_uri: CALLBACK,
        code_verifier: verifier,
      },
      { accept: 'application/json' },
    ),
  );
  const token = ((await redeemed.json()) as { access_token?: string }).access_token;
  assert.ok(token !== undefined, 'the code was redeemed for a token');
  return token;
}

async function micropub(cms: Cms, token: string): Promise<void> {
  const authorization = { authorization: `Bearer ${token}` };
  const note = await cms.app.request(
    '/_geekity/micropub',
    form(
      { h: 'entry', content: 'At the tower.', location: 'geo:48.85837,2.29448;u=50' },
      authorization,
    ),
  );
  assert.equal(note.status, 201, 'the note was created');
  const ate = await cms.app.request('/_geekity/micropub', {
    method: 'POST',
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: ['h-entry'],
      properties: {
        content: ['Lunch'],
        ate: [{ type: ['h-food'], properties: { name: ['Tacos'] } }],
      },
    }),
  });
  assert.equal(ate.status, 201, 'the post with an unknown property was created');

  const body = new FormData();
  body.set('file', new File([new Uint8Array(png(400, 300))], 'Sunset.png', { type: 'image/png' }));
  const uploaded = await cms.app.request('/_geekity/micropub/media', {
    method: 'POST',
    headers: authorization,
    body,
  });
  assert.equal(uploaded.status, 201, 'the photo was uploaded');
  const photo = new URL(uploaded.headers.get('location') ?? '').pathname;
  const variant = await cms.app.request(photo.replace(/^\/uploads\//, '/uploads/_/') + '/320.webp');
  assert.equal(variant.status, 200, 'a variant of the photo was drawn');
}

async function suggestTags(cms: Cms, admin: Admin): Promise<void> {
  await cms.settings.set(
    LLM,
    new Map<string, unknown>([
      ['base_url', provider.baseUrl],
      ['default_model', 'acme/tiny-1'],
      ['api_key', 'sk-census'],
    ]),
    'admin',
  );
  await cms.settings.set(TAGS, new Map([['tags_server', tagsPub.url]]), 'admin');
  provider.answer(replying(JSON.stringify({ forThisPost: ['IndieWeb'], forReach: [] })));
  const answer = await admin.post(`/admin/plugins/${TAGS}/editor/suggest-tags`, {
    type: 'post',
    title: 'Owning my words',
    body: 'Why I publish on my own site.',
  });
  assert.equal(answer.status, 200);
  assert.equal(((await answer.json()) as { ok: boolean }).ok, true, 'tags were suggested');
}

async function moveFromWordPress(cms: Cms, dataDir: string): Promise<void> {
  const data = pluginDataFolder(dataDir, wordpress);
  const site = pluginSite({ admin: cms.admin, config: cms.config });
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  await importWordPressActor({
    site,
    records: wordPressRecords(data),
    username: 'andrew',
    actorId: `${BASE}/?author=2`,
    wordpressActorId: 2,
    privateKeyPem: pair.privateKey,
    publicKeyPem: pair.publicKey,
    followers: false,
  });
  const actor = await cms.app.request(
    new Request(`${BASE}/wp-json/activitypub/1.0/actors/2`, {
      headers: { accept: 'application/activity+json' },
    }),
  );
  assert.equal(actor.status, 200, 'the old actor path answered');

  const exportFile = path.join(await temporaryDir('geekity-census-export-'), 'export.xml');
  writeFileSync(exportFile, wxr([{ id: 7, title: 'Imported', slug: 'imported' }]));
  const code = await contentImportCommand(data).run({
    args: [exportFile],
    options: {},
    cwd: path.dirname(exportFile),
    site,
    write: () => undefined,
  });
  assert.equal(code, 0, 'the content import ran');
}

async function settings(cms: Cms): Promise<void> {
  await cms.settings.set(
    'mail',
    new Map<string, unknown>([
      ['smtp_host', 'smtp.example'],
      ['smtp_user', 'webmaster'],
      ['smtp_password', 'hunter2'],
    ]),
    'admin',
  );
  await cms.settings.set('akismet', new Map([['key', 'akismet-key']]), 'admin');
  await cms.settings.set('maintenance', new Map([['on', true]]), 'admin');
  await cms.settings.set('dev_mode', new Map([['on', true]]), 'admin');
}

function unreachable(cms: Cms, declaration: DataFileDeclaration): boolean {
  if (declaration.dataClass.kind === 'scratch') return true;
  const secrets = /^plugins\/(.+)\/secrets\.json$/.exec(declaration.pattern)?.[1];
  return (
    secrets !== undefined &&
    !cms.settings
      .list()
      .some((setting) => setting.namespace === secrets && setting.declaration.secret === true)
  );
}

describe('the data census', () => {
  it('drives every writer, and every file under data/ is declared', async () => {
    const site = await bootSite();
    const { cms, admin, dataDir } = site;
    try {
      const actor = await cms.app.request('/author/ada/', {
        headers: { accept: 'application/activity+json' },
      });
      assert.equal(actor.status, 200, "ada's actor was drawn, minting her keys");
      await discuss(site);
      await contact(cms);
      cms.admin.putFollower({
        username: ADA.username,
        actorId: 'https://remote.example/users/bob',
        inboxId: 'https://remote.example/users/bob/inbox',
        sharedInboxId: null,
        handle: '@bob@remote.example',
        name: 'Bob',
        iconUrl: null,
        url: null,
      });
      await micropub(cms, await indieAuthToken(cms, admin));
      const avatar = await cms.app.request(
        `/_geekity/avatars/${Buffer.from(AVATAR).toString('base64url')}`,
      );
      assert.equal(avatar.status, 200, 'the avatar was fetched');
      assert.equal(
        (await admin.post('/admin/tools/maintenance/strip-metadata', {})).status,
        303,
        'the metadata sweep was queued',
      );
      assert.equal(
        (await admin.post('/admin/plugins/remove', { plugin: GONE, password: ADA.password }))
          .status,
        303,
        'a folder plugin was removed',
      );
      await suggestTags(cms, admin);
      await moveFromWordPress(cms, dataDir);
      await settings(cms);
      const queue = new DatabaseSync(path.join(dataDir, 'queue.sqlite'), { readOnly: true });
      const waiting = queue.prepare('SELECT count(*) AS waiting FROM federation_messages').get();
      queue.close();
      assert.ok(Number(waiting?.['waiting']) > 0, 'the Create for the follower waits in the queue');

      const declarations = cms.dataFiles();
      const reached = new Set<DataFileDeclaration>();
      const undeclared: string[] = [];
      for (const { relative, declaration } of classifyFiles(dataDir, declarations)) {
        if (declaration === undefined) undeclared.push(relative);
        else reached.add(declaration);
      }
      assert.deepEqual(
        undeclared.map(
          (file) =>
            `data/${file} has no declaration. Declare it in packages/cms/src/files/data-files.ts with its class and build its path with dataPath, or, for a plugin's file, add it to the plugin's \`data\` field.`,
        ),
        [],
      );
      assert.deepEqual(
        declarations
          .filter((declaration) => !reached.has(declaration) && !unreachable(cms, declaration))
          .map(
            (declaration) =>
              `${declaration.pattern} (${declaration.dataClass.kind}) is declared, and no writer this census drives made a file it covers. Drive its writer here, or remove the declaration.`,
          ),
        [],
      );
    } finally {
      await cms.close();
    }
  });
});
