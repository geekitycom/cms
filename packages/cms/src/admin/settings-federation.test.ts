import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ADMIN_SECTIONS } from './menu.ts';
import { FEDERATION_SETTINGS } from './settings-federation.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
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

describe('where the Federation settings live', () => {
  it('is a child of the Federation section, second, behind Followers (AC #1, AC #3)', () => {
    const federation = ADMIN_SECTIONS.find((section) => section.section === 'federation');

    assert.deepEqual(
      federation?.children.map((child) => [child.child, child.label, child.url]),
      [
        ['followers', 'Followers', '/admin/federation'],
        ['settings', 'Settings', '/admin/federation/settings'],
      ],
    );
    assert.equal(
      federation?.url,
      '/admin/federation',
      'the heading lands on Followers, which is what the section is opened to look at',
    );
    assert.equal(FEDERATION_SETTINGS.path, '/admin/federation/settings');
    assert.equal(FEDERATION_SETTINGS.section, 'federation');
  });

  it('marks itself under Federation rather than under Settings (AC #1)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/federation/settings')).text();

    assert.match(
      html,
      /<a[^>]*href="\/admin\/federation\/settings"[^>]*aria-current="page"/,
      'the menu marks Federation > Settings',
    );
    assert.doesNotMatch(
      html,
      /<a[^>]*href="\/admin\/settings\/federation"/,
      'and nothing links to the old place',
    );
  });

  it('answers the old /admin/settings/federation with a redirect, not a 404 (AC #4)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const response = await agent.get('/admin/settings/federation');

    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/admin/federation/settings');
  });
});

describe('the Federation page', () => {
  it('carries the relay list and nothing about an actor (decision-14)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/federation/settings')).text();

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
      federation: { queue: null, allowPrivateAddress: true },
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

    const html = await (await agent.get('/admin/federation/settings')).text();
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

    const back = await (await agent.get('/admin/federation/settings')).text();
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

describe('what the page leaves to plugins', () => {
  it('carries no compatibility switch and no record of old paths (TASK-282)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/federation/settings')).text();

    assert.doesNotMatch(html, /wp-json|activitypub_compat|Last asked for/i);
    assert.deepEqual(FEDERATION_SETTINGS.fields, ['relays']);
  });
});
