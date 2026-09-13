import assert from 'node:assert/strict';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import { browser, csrfField, sandbox, setUpFirstAdmin } from './admin/__testing__/harness.ts';
import type { Browser } from './admin/__testing__/harness.ts';
import { databaseFile, databaseFiles, UnusableDatabaseError } from './cache.ts';
import { IMAGE_DIRECTORY } from './images/index.ts';
import type { Cms } from './index.ts';

/**
 * The milestone test for decision-9: a site whose database is deleted comes
 * back exactly as it was, because everything in the database was a reading of
 * the files all along. Everything a reader, a follower or an admin can see is
 * captured before the delete and compared after it.
 */

const box = sandbox();

after(async () => {
  await box.cleanup();
});

describe('a database this package cannot use', () => {
  it('refuses the boot rather than being thrown away, and says both ways out', async () => {
    const contentDir = await box.dir('geekity-rebuild-newer-content-');
    const dataDir = await box.dir('geekity-rebuild-newer-data-');

    const first = await box.open({ contentDir, dataDir });
    await first.close();

    // What a downgrade looks like from here: a schema version recorded by a
    // later @geekity/cms, which this one has no migration for.
    const db = new DatabaseSync(databaseFile(dataDir));
    db.prepare('INSERT INTO admin_migrations (version, applied_at) VALUES (?, ?)').run(
      9999,
      new Date().toISOString(),
    );
    db.close();

    await assert.rejects(
      async () => await box.open({ contentDir, dataDir }),
      (error: unknown) => {
        assert.ok(error instanceof UnusableDatabaseError);
        assert.match(error.message, /geekity\.db/);
        assert.match(error.message, /9999/);
        assert.match(error.message, /geekity rebuild/);
        return true;
      },
    );
  });

  it('names the file when it is not a database at all', async () => {
    const contentDir = await box.dir('geekity-rebuild-damaged-content-');
    const dataDir = await box.dir('geekity-rebuild-damaged-data-');
    await writeFile(databaseFile(dataDir), 'a note somebody left where the database goes\n');

    await assert.rejects(
      async () => await box.open({ contentDir, dataDir }),
      (error: unknown) => {
        assert.ok(error instanceof UnusableDatabaseError);
        assert.match(error.message, /geekity\.db/);
        assert.match(error.message, /geekity rebuild/);
        return true;
      },
    );
  });
});

/** The account the captured login is made with, and so the site's one actor. */
const ADMIN = { username: 'ada', password: 'correct horse battery' };

/** Where that account's actor and its collections live (decision-14). */
const ACTOR_PATH = `/author/${ADMIN.username}/`;

const ADA = 'https://remote.example/users/ada';
const GRACE = 'https://remote.example/users/grace';

/** Where the post's picture lives under `content/uploads/`. */
const UPLOAD = '2026/09/photo.jpg';

/**
 * The site's own address, named rather than left to the default because the
 * post carries an `activitypub.id` under it: an object id is minted once and
 * kept, and only a site at that host answers for it.
 */
const BASE_URL = 'https://blog.example';

/** One follower as the file spells them. */
function follower(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actorId: ADA,
    inboxId: `${ADA}/inbox`,
    sharedInboxId: 'https://remote.example/inbox',
    handle: '@ada@remote.example',
    name: 'Ada Lovelace',
    iconUrl: 'https://remote.example/avatars/ada.png',
    url: 'https://remote.example/@ada',
    followedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * A site with something of every kind decision-9 names: settings, published
 * posts, an upload the markup derives pictures from, followers and an inbox
 * log. The accounts and the actor's keys are not written here — they arrive
 * through the setup form and through the first request for the actor, which is
 * how a real site gets them.
 */
async function populatedSite(): Promise<{ contentDir: string; dataDir: string; baseUrl: string }> {
  const contentDir = await box.dir('geekity-rebuild-content-');
  const dataDir = await box.dir('geekity-rebuild-data-');

  async function write(relative: string, contents: string | Buffer): Promise<void> {
    const file = path.join(contentDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }

  await write(
    '_data/site.json',
    `${JSON.stringify(
      {
        title: 'A site that can be rebuilt',
        tagline: 'Everything here is a file',
        author: 'Ada Lovelace',
        timezone: 'America/Chicago',
        postsPerPage: 5,
      },
      null,
      2,
    )}\n`,
  );

  // Its `activitypub.id` is the shape a post migrated from elsewhere carries:
  // the CMS never mints one, but a stored id is honoured for the life of the
  // post (decision-13), so the object answers there and the inbox log below
  // names it.
  await write(
    'posts/2026-09-01-hello.md',
    [
      '---',
      'title: Hello',
      'permalink: /2026/09/hello/',
      'date: 2026-09-01T12:00:00.000Z',
      // decision-14: a post belongs to a user, and the outbox is that user's
      // archive as activities.
      `author: ${ADMIN.username}`,
      'tags: [eleventy, sqlite]',
      'categories: [general]',
      'activitypub:',
      '  id: https://blog.example/ap/posts/hello',
      '  published: 2026-09-01T12:00:00.000Z',
      '---',
      '',
      'Hello, with a picture.',
      '',
      `![A blue rectangle](/uploads/${UPLOAD})`,
      '',
    ].join('\n'),
  );

  await write(
    'posts/2026-09-02-second.md',
    [
      '---',
      'title: Second',
      'permalink: /2026/09/second/',
      'date: 2026-09-02T12:00:00.000Z',
      `author: ${ADMIN.username}`,
      'tags: [eleventy]',
      '---',
      '',
      'The second one.',
      '',
    ].join('\n'),
  );

  await write(
    'pages/about.md',
    ['---', 'title: About', 'permalink: /about/', '---', '', 'About this site.', ''].join('\n'),
  );

  await write(
    `uploads/${UPLOAD}`,
    await sharp({
      create: { width: 1600, height: 900, channels: 3, background: { r: 40, g: 90, b: 160 } },
    })
      .jpeg()
      .toBuffer(),
  );

  await write(
    `_data/federation/${ADMIN.username}/followers.json`,
    `${JSON.stringify(
      [
        follower(),
        follower({
          actorId: GRACE,
          inboxId: `${GRACE}/inbox`,
          sharedInboxId: null,
          handle: '@grace@remote.example',
          name: 'Grace Hopper',
          iconUrl: null,
          url: 'https://remote.example/@grace',
          followedAt: '2026-09-02T10:00:00.000Z',
        }),
      ],
      null,
      2,
    )}\n`,
  );

  await write(
    '_data/federation/inbox/2026-09.jsonl',
    [
      JSON.stringify({
        receivedAt: '2026-09-03T10:00:00.000Z',
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example/likes/1',
        type: 'Like',
        actor: ADA,
        object: 'https://blog.example/ap/posts/hello',
      }),
      JSON.stringify({
        receivedAt: '2026-09-04T10:00:00.000Z',
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://remote.example/creates/1',
        type: 'Create',
        actor: ADA,
        object: {
          id: 'https://remote.example/notes/1',
          type: 'Note',
          content: '<p>Good post.</p>',
          inReplyTo: 'https://blog.example/ap/posts/hello',
        },
      }),
      '',
    ].join('\n'),
  );

  return { contentDir, dataDir, baseUrl: BASE_URL };
}

/** An ActivityStreams document, fetched the way a peer fetches one. */
async function activityStreams(cms: Cms, url: string): Promise<unknown> {
  const response = await cms.app.request(url, {
    headers: { accept: 'application/activity+json' },
  });
  assert.equal(response.status, 200, url);
  return await response.json();
}

/**
 * A rendered admin screen with the one thing on it that is per-session taken
 * out. A CSRF token is minted per session, so two logins legitimately differ
 * there and nowhere else; see {@link capture}.
 */
function withoutCsrf(html: string): string {
  return html.replaceAll(/name="csrf_token" value="[^"]*"/g, 'name="csrf_token"');
}

/**
 * A rendered public page with the one thing on it that is per-render taken
 * out.
 *
 * The comment form stamps the moment it was rendered, which is what the
 * minimum submit time is measured against; two renders a second apart
 * legitimately differ there and nowhere else.
 */
function withoutFormAge(html: string): string {
  return html.replaceAll(/name="loaded" value="[^"]*"/g, 'name="loaded"');
}

/** One admin screen, as the signed-in browser sees it. */
async function screen(agent: Browser, url: string): Promise<string> {
  const response = await agent.get(url);
  assert.equal(response.status, 200, url);
  return await response.text();
}

/** Sign in through the login form, the way a person does. */
async function logIn(cms: Cms): Promise<{ agent: Browser; status: number; location: string }> {
  const agent = browser(cms);
  const token = csrfField(await (await agent.get('/admin/login')).text());
  assert.ok(token !== undefined);

  const response = await agent.post('/admin/login', {
    csrf_token: token,
    username: ADMIN.username,
    password: ADMIN.password,
  });
  return { agent, status: response.status, location: response.headers.get('location') ?? '' };
}

/**
 * Everything a reader, a follower and an admin can see, in one object that can
 * be compared with `deepEqual`.
 *
 * Three things are deliberately normalised, and only three. The session cookie
 * is new every login by design, so it is not captured at all. The CSRF token is
 * minted per session for the same reason, so {@link withoutCsrf} takes it out
 * of the two screens that carry one, and the comment form's `loaded` stamp is
 * per render, so {@link withoutFormAge} takes that out of the post. Everything
 * else — the actor document with
 * its public keys, the followers collection, the outbox, the settings form's
 * values, the rendered post with its `<picture>`, the bytes of a derived image
 * — is asserted byte for byte.
 */
async function capture(cms: Cms): Promise<Record<string, unknown>> {
  const { agent, status, location } = await logIn(cms);

  const post = await cms.app.request('/2026/09/hello/');
  assert.equal(post.status, 200);

  const variant = await cms.app.request(`/uploads/_/${UPLOAD}/640.webp`);
  assert.equal(variant.status, 200, 'the 640px WebP was served');

  return {
    actor: await activityStreams(cms, ACTOR_PATH),
    webfinger: await (
      await cms.app.request(`/.well-known/webfinger?resource=acct:${ADMIN.username}@blog.example`)
    ).json(),
    followers: await activityStreams(cms, `${ACTOR_PATH}followers/`),
    followersPage: await activityStreams(cms, `${ACTOR_PATH}followers/?cursor=0`),
    outbox: await activityStreams(cms, `${ACTOR_PATH}outbox/`),
    outboxPage: await activityStreams(cms, `${ACTOR_PATH}outbox/?cursor=0`),
    // At the stored id, and at the permalink, which is where a post without a
    // stored one answers.
    postObject: await activityStreams(cms, '/ap/posts/hello'),
    postAtPermalink: await activityStreams(cms, '/2026/09/hello/'),
    login: { status, location },
    settings: withoutCsrf(await screen(agent, '/admin/settings')),
    federationScreen: withoutCsrf(await screen(agent, '/admin/federation')),
    post: withoutFormAge(await post.text()),
    variant: {
      type: variant.headers.get('content-type'),
      bytes: Buffer.from(await variant.arrayBuffer()).toString('base64'),
    },
  };
}

describe('a site whose database and derived images are deleted', () => {
  it('serves exactly what it served before, from content/ and data/ alone (AC #3, AC #6)', async () => {
    const dirs = await populatedSite();

    const first = await box.open(dirs);
    await setUpFirstAdmin(browser(first), ADMIN);
    // The picture has to have been derived once for the page to carry a
    // <picture>; a real site derives it on upload, and this is the request
    // that stands in for that.
    assert.equal((await first.app.request(`/uploads/_/${UPLOAD}/640.webp`)).status, 200);
    const before = await capture(first);
    await first.close();

    // The captures are only worth comparing if they carry the things this
    // milestone is about, so each is named once here.
    assert.match(String(before['post']), /<picture>/, 'the page renders derived pictures');
    assert.match(String(before['post']), /640\.webp/);
    assert.match(JSON.stringify(before['followers']), /totalItems":2/);
    assert.match(JSON.stringify(before['outbox']), /totalItems":2/);
    assert.match(JSON.stringify(before['actor']), /publicKeyPem/);
    assert.match(String(before['federationScreen']), /Ada Lovelace/);
    assert.match(String(before['federationScreen']), /Grace Hopper/);
    assert.match(String(before['federationScreen']), /replied to/);
    assert.match(String(before['federationScreen']), /liked/);
    assert.deepEqual(before['login'], { status: 303, location: '/admin' });

    // Everything decision-9 says a site may delete at rest.
    for (const file of databaseFiles(dirs.dataDir)) await rm(file, { force: true });
    await rm(path.join(dirs.dataDir, IMAGE_DIRECTORY), { recursive: true, force: true });
    assert.deepEqual(
      (await readdir(dirs.dataDir)).sort(),
      ['keys', 'users.json'],
      'what is left is exactly what decision-9 says to back up',
    );

    const second = await box.open(dirs);
    const after = await capture(second);

    assert.deepEqual(after, before);

    // One thing this cannot see, because both boots are in one process: the
    // image records are cached per process and deliberately survive their
    // sidecar being deleted, so the second boot's page carries its <picture>
    // straight away. A genuinely cold process renders the plain <img> until
    // the first request for a variant derives the set again — which is the
    // request above, and which is what makes the bytes compared here the
    // bytes of a file rebuilt from `content/uploads/` rather than a survivor.
    assert.ok(
      (await readdir(path.join(dirs.dataDir, IMAGE_DIRECTORY, ...UPLOAD.split('/')))).length > 0,
      'the derived directory was written again',
    );
  });
});
