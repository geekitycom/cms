import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox, signedIn } from './__testing__/harness.ts';
import { saveSettings } from './__testing__/settings.ts';
import { readSiteSettings } from './settings.ts';

/**
 * The Federation settings page: who the site is on the fediverse, and which
 * relays boost it.
 */

const box = sandbox();
after(() => box.cleanup());

describe('saving the Federation page', () => {
  it('reaches the ActivityPub actor without a restart (AC #1)', async () => {
    const base = 'https://actor.example';
    const cms = await box.site({ baseUrl: base });
    const agent = await signedIn(cms);

    // The name and the summary are General's fields and the handle is this
    // page's: an actor is built out of two pages, and a save of either tells
    // the followers about the whole of it.
    await saveSettings(agent, 'general', {
      title: 'The Actor Renamed',
      tagline: 'and re-summarised',
      base_url: base,
    });
    await saveSettings(agent, 'federation', { actor_handle: 'writer' });

    const actor = (await (
      await cms.app.request(
        new Request(`${base}/ap/actor`, { headers: { accept: 'application/activity+json' } }),
      )
    ).json()) as Record<string, unknown>;

    assert.equal(actor['name'], 'The Actor Renamed');
    assert.match(String(actor['summary']), /and re-summarised/);
    assert.equal(actor['preferredUsername'], 'writer');
  });
});

describe('a Federation form the validator refuses', () => {
  it('refuses an actor handle that is not username-like, and an unknown actor type', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    for (const bad of ['@blog', 'my blog', 'blog@example.com', '']) {
      const response = await saveSettings(agent, 'federation', { actor_handle: bad });
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.match(await response.text(), /An actor handle is 1 to 64/, JSON.stringify(bad));
    }

    const response = await saveSettings(agent, 'federation', { actor_type: 'Sasquatch' });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /An actor type is one of Person/);
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
