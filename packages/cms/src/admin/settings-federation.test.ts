import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { recordWordPressRequest } from '../federation/wordpress.ts';
import { writeUsers } from './__testing__/users.ts';
import { sandbox, signedIn, signIn } from './__testing__/harness.ts';
import { saveSettings } from './__testing__/settings.ts';
import { readSiteSettings } from './settings.ts';

/**
 * The Federation settings page: which relays boost the site.
 *
 * Who the site's people are on the fediverse is not here any more
 * (decision-14): every user is an actor, and their profile is theirs.
 */

const box = sandbox();
after(() => box.cleanup());

describe('the Federation page', () => {
  it('carries the relay list and nothing about an actor (decision-14)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/settings/federation')).text();

    assert.match(html, /name="relays"/);
    // The handle, the type and the picture a site used to federate under are a
    // user's profile now, edited on the users screen.
    assert.doesNotMatch(html, /actor_handle|actor_type/);
  });
});

describe('the relays setting', () => {
  /**
   * A site whose relay follows go nowhere: `fetch` is answered from here, and
   * the queue is off so the follow is over by the time the save answers.
   * Without both, the follow would go out over the real network and Fedify's
   * queue would go on retrying it after the test had finished.
   */
  let restoreFetch: (() => void) | undefined;

  before(() => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(href).hostname.endsWith('.example')) return new Response('', { status: 202 });
      return await original(input, init);
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = original;
    };
  });

  after(() => restoreFetch?.());

  /** A site that can follow a make-believe relay without leaving the process. */
  async function relaySite(contentDir?: string) {
    return await box.site({
      ...(contentDir === undefined ? {} : { contentDir }),
      federation: { queue: null },
    });
  }

  /** The content of a named textarea in the rendered settings screen. */
  function textarea(html: string, name: string): string | undefined {
    const match = new RegExp(`<textarea[^>]*name="${name}"[^>]*>([\\s\\S]*?)</textarea>`).exec(
      html,
    );
    return match?.[1];
  }

  it('starts empty, takes one inbox URL per line and reaches site.json', async () => {
    const contentDir = await box.dir('geekity-settings-relays-');
    const cms = await relaySite(contentDir);
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/settings/federation')).text();
    assert.equal(textarea(html, 'relays'), '', 'a new site subscribes to no relay');

    assert.equal(
      (
        await saveSettings(agent, 'federation', {
          relays: 'https://relay.example/inbox\n\nhttps://tags.example/user/_____relay_____/inbox',
        })
      ).status,
      303,
    );
    await cms.relays.settled();
    assert.deepEqual(readSiteSettings(cms.config.contentDir).relays, [
      'https://relay.example/inbox',
      'https://tags.example/user/_____relay_____/inbox',
    ]);

    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.deepEqual(written['relays'], [
      'https://relay.example/inbox',
      'https://tags.example/user/_____relay_____/inbox',
    ]);

    const back = await (await agent.get('/admin/settings/federation')).text();
    assert.equal(
      textarea(back, 'relays'),
      'https://relay.example/inbox\nhttps://tags.example/user/_____relay_____/inbox',
    );
  });

  it('keeps the whole inbox path, and drops a repeated one', async () => {
    const cms = await relaySite();
    const agent = await signedIn(cms);

    await saveSettings(agent, 'federation', {
      relays:
        'https://relay.example/user/_____relay_____/inbox/\nhttps://relay.example/user/_____relay_____/inbox',
    });

    await cms.relays.settled();
    assert.deepEqual(readSiteSettings(cms.config.contentDir).relays, [
      'https://relay.example/user/_____relay_____/inbox',
    ]);
  });

  it('refuses a line that is not an absolute URL, and keeps the stored list', async () => {
    const cms = await relaySite();
    const agent = await signedIn(cms);

    assert.equal(
      (await saveSettings(agent, 'federation', { relays: 'https://kept.example/inbox' })).status,
      303,
    );

    for (const bad of ['relay.example/inbox', 'ftp://relay.example/inbox', '/inbox']) {
      const response = await saveSettings(agent, 'federation', { relays: bad });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(
        await response.text(),
        /absolute http:\/\/ or https:\/\/ URL/,
        JSON.stringify(bad),
      );
    }

    await cms.relays.settled();
    assert.deepEqual(readSiteSettings(cms.config.contentDir).relays, [
      'https://kept.example/inbox',
    ]);
  });
});

describe('the WordPress ActivityPub compatibility switch', () => {
  /** `content/_data/site.json` as it is on disk right now. */
  async function siteJson(contentDir: string): Promise<Record<string, unknown>> {
    return JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
  }

  it('is off, and site.json says nothing about it until it is on (AC #1)', async () => {
    const contentDir = await box.dir('geekity-settings-wordpress-');
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/settings/federation')).text();
    assert.match(html, /name="wordpress_activitypub"/, 'the switch is on the page');
    assert.doesNotMatch(
      html,
      /name="wordpress_activitypub"[^>]*\schecked/,
      'and it starts turned off',
    );

    assert.equal((await saveSettings(agent, 'federation')).status, 303);
    assert.equal(readSiteSettings(contentDir).wordpressActivityPub, false);
    assert.ok(
      !('wordpressActivityPub' in (await siteJson(contentDir))),
      'a site that has never turned it on does not carry the key',
    );

    assert.equal(
      (await saveSettings(agent, 'federation', { wordpress_activitypub: '1' })).status,
      303,
    );
    assert.equal(readSiteSettings(contentDir).wordpressActivityPub, true);
    assert.equal((await siteJson(contentDir))['wordpressActivityPub'], true);

    assert.equal((await saveSettings(agent, 'federation')).status, 303);
    assert.ok(
      !('wordpressActivityPub' in (await siteJson(contentDir))),
      'and turning it off takes the key out again',
    );
  });
});

describe('when the WordPress paths were last asked for (AC #3)', () => {
  it('lists every route beside the switch, with never until one is asked for', async () => {
    const dataDir = await box.dir('geekity-settings-wp-data-');
    writeUsers(dataDir, [{ username: 'ada', password: 'correct horse', wordpressActorId: 2 }]);
    const cms = await box.site({ dataDir });
    const agent = await signIn(cms, { username: 'ada', password: 'correct horse' });

    const empty = await (await agent.get('/admin/settings/federation')).text();
    assert.match(empty, /wp-json\/activitypub\/1\.0\/actors\/2\/inbox/);
    assert.match(empty, /wp-json\/activitypub\/1\.0\/inbox/);
    assert.match(empty, /Never/, 'a path nobody has asked for says so');
    assert.match(empty, /refetched the actor/, 'and the note says when to turn the switch off');

    await recordWordPressRequest({
      dataDir,
      target: { route: 'inbox', wordpressActorId: '2' },
      username: 'ada',
      at: new Date('2026-09-01T10:00:00.000Z'),
    });

    const asked = await (await agent.get('/admin/settings/federation')).text();
    assert.match(asked, /1 September 2026|September 1, 2026|2026/, 'the instant is shown');
  });

  it('says so when no user carries a WordPress actor id', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/settings/federation')).text();

    assert.match(html, /No user carries a WordPress actor id/);
  });
});
