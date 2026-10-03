import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, FIRST_ADMIN, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { findUser } from '../admin/accounts.ts';
import { updateSiteSettings } from '../admin/settings.ts';
import { KEPT_PROPERTIES_FILE } from '../content/kept-properties.ts';
import type { LocationSharing } from '../content/location.ts';
import { LOCATIONS_FILE } from '../content/locations.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';
import { feedPathUnder } from '../web/feed-source.ts';
import { OEMBED_PATH } from '../web/oembed.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const ENDPOINT = '/_geekity/micropub';
const NOW = new Date('2026-09-20T12:00:00.000Z');

interface Site {
  cms: Cms;
  agent: Browser;
  token: string;
}

async function site(sharing: LocationSharing = 'none'): Promise<Site> {
  const contentDir = await box.dir('geekity-micropub-checkin-content-');
  if (sharing !== 'none') {
    await updateSiteSettings({ contentDir, change: (s) => ({ ...s, locationSharing: sharing }) });
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-micropub-checkin-data-'),
    baseUrl: BASE,
    now: () => NOW,
  });
  const agent = await signedIn(cms);
  const ada = findUser(cms.config.dataDir, FIRST_ADMIN.username);
  assert.ok(ada !== undefined);
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://micropub.rocks/',
      redirectUri: 'https://micropub.rocks/redirect',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes: ['create', 'update', 'delete'],
    },
    NOW,
  );
  return { cms, agent, token: accessToken };
}

async function postJson(cms: Cms, token: string, body: unknown): Promise<Response> {
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function created(response: Response): Promise<string> {
  assert.equal(response.status, 201, await response.clone().text());
  const location = response.headers.get('location');
  assert.ok(location !== null, 'a 201 names the post');
  return location;
}

async function refusal(response: Response): Promise<string> {
  assert.equal(response.status, 400, await response.clone().text());
  const body = (await response.json()) as Record<string, string>;
  assert.equal(body['error'], 'invalid_request');
  return body['error_description'] ?? '';
}

async function updated(cms: Cms, token: string, body: object): Promise<void> {
  const response = await postJson(cms, token, body);
  assert.equal(response.status, 204, await response.text());
}

async function source(cms: Cms, token: string, url: string): Promise<Record<string, unknown[]>> {
  const response = await cms.app.request(`${ENDPOINT}?q=source&url=${encodeURIComponent(url)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200, await response.clone().text());
  return ((await response.json()) as { properties: Record<string, unknown[]> }).properties;
}

async function storedLocations(cms: Cms): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(cms.config.dataDir, LOCATIONS_FILE), 'utf8'),
  ) as Record<string, unknown>;
}

async function filesUnder(root: string): Promise<[string, string][]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry): Promise<[string, string]> => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(root, file), await readFile(file, 'utf8')];
      }),
  );
}

async function text(cms: Cms, pathname: string, accept?: string): Promise<string> {
  const response = await cms.app.request(
    pathname,
    accept === undefined ? {} : { headers: { accept } },
  );
  assert.equal(response.status, 200, `${pathname} as ${accept ?? 'html'}`);
  return await response.text();
}

const ROCKS_204 = {
  type: ['h-entry'],
  properties: {
    published: ['2017-05-31T12:03:36-07:00'],
    content: ['Lunch meeting'],
    checkin: [
      {
        type: ['h-card'],
        properties: {
          name: ['Los Gorditos'],
          url: ['https://foursquare.com/v/502c4bbde4b06e61e06d1ebf'],
          latitude: [45.524330801154],
          longitude: [-122.68068281969],
          'street-address': ['922 NW Everett St'],
          locality: ['Portland'],
          region: ['OR'],
          'country-name': ['United States'],
          'postal-code': ['97209'],
        },
      },
    ],
  },
};

const GORDITOS = {
  geo: { latitude: 45.524330801154, longitude: -122.68068281969 },
  name: 'Los Gorditos',
  locality: 'Portland',
  region: 'OR',
  country: 'United States',
  checkin: true,
};

const SECRETS = [
  'Los Gorditos',
  'Portland',
  '45.52433',
  '-122.68068',
  '922 NW Everett',
  '97209',
  'foursquare',
  'p-location',
  'checkin',
  '"Place"',
];

describe('micropub.rocks test 204 (AC #1)', () => {
  it('answers 201, publishes the content and keeps the checkin as the post’s location', async () => {
    const { cms, token } = await site();
    const url = await created(await postJson(cms, token, ROCKS_204));
    const permalink = new URL(url).pathname;

    assert.match(await text(cms, permalink), /Lunch meeting/);
    assert.deepEqual(await storedLocations(cms), { [permalink]: GORDITOS });
    assert.equal((await stat(path.join(cms.config.dataDir, LOCATIONS_FILE))).mode & 0o777, 0o600);
    await assert.rejects(
      stat(path.join(cms.config.dataDir, KEPT_PROPERTIES_FILE)),
      'a mapped checkin is not kept as a property the site does not understand',
    );
  });

  it('publishes a checkin with no content, as Swarm sends one', async () => {
    const { cms, token } = await site();
    const url = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: { checkin: ROCKS_204.properties.checkin },
      }),
    );
    assert.deepEqual((await storedLocations(cms))[new URL(url).pathname], GORDITOS);
  });

  it('takes a location beside the checkin as the same place, the checkin’s words first', async () => {
    const { cms, token } = await site();
    const url = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: {
          content: ['Coffee.'],
          checkin: [{ type: ['h-card'], properties: { name: ['Cafe'], locality: ['Lyon'] } }],
          location: ['geo:45.76,4.83;u=20'],
        },
      }),
    );
    assert.deepEqual((await storedLocations(cms))[new URL(url).pathname], {
      geo: { latitude: 45.76, longitude: 4.83, accuracy: 20 },
      name: 'Cafe',
      locality: 'Lyon',
      checkin: true,
    });
  });

  it('refuses a checkin that is not an h-card naming a place, by name, and writes nothing', async () => {
    const { cms, token } = await site();
    for (const [checkin, says] of [
      ['https://foursquare.com/v/1', /checkin is an h-card/],
      [{ type: ['h-card'], properties: { url: ['https://a.example/'] } }, /checkin names no/],
    ] as const) {
      const response = await postJson(cms, token, {
        type: ['h-entry'],
        properties: { content: ['Where?'], checkin: [checkin] },
      });
      assert.match(await refusal(response), says, JSON.stringify(checkin));
    }
    const two = await postJson(cms, token, {
      type: ['h-entry'],
      properties: {
        content: ['Where?'],
        checkin: [...ROCKS_204.properties.checkin, ...ROCKS_204.properties.checkin],
      },
    });
    assert.match(await refusal(two), /checkin takes one value/);
    assert.deepEqual(await readdir(path.join(cms.config.contentDir, 'posts')).catch(() => []), []);
  });
});

describe('reading and changing a checkin (AC #2)', () => {
  it('answers q=source with the checkin as checkin, which a create takes back as the same', async () => {
    const { cms, token } = await site();
    const url = await created(await postJson(cms, token, ROCKS_204));
    const properties = await source(cms, token, url);
    assert.equal('location' in properties, false);
    const [checkin] = properties['checkin'] ?? [];
    assert.deepEqual((checkin as { type: string[] }).type, ['h-card']);

    const again = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: { content: ['Again.'], checkin: properties['checkin'] },
      }),
    );
    assert.deepEqual((await storedLocations(cms))[new URL(again).pathname], GORDITOS);
  });

  it('replaces and deletes the checkin on an update, leaving the rest alone', async () => {
    const { cms, token } = await site();
    const url = await created(await postJson(cms, token, ROCKS_204));
    const permalink = new URL(url).pathname;

    await updated(cms, token, {
      action: 'update',
      url,
      replace: {
        checkin: [{ type: ['h-card'], properties: { name: ['Cafe'], locality: ['Lyon'] } }],
      },
    });
    assert.deepEqual((await storedLocations(cms))[permalink], {
      name: 'Cafe',
      locality: 'Lyon',
      checkin: true,
    });

    await updated(cms, token, { action: 'update', url, replace: { content: ['Dinner.'] } });
    assert.deepEqual(
      (await storedLocations(cms))[permalink],
      { name: 'Cafe', locality: 'Lyon', checkin: true },
      'an update that does not name it leaves it',
    );

    await updated(cms, token, { action: 'update', url, delete: ['checkin'] });
    assert.equal(permalink in (await storedLocations(cms)), false);
    const properties = await source(cms, token, url);
    assert.equal('checkin' in properties, false);
    assert.deepEqual(properties['content'], ['Dinner.']);
  });

  it('becomes an ordinary location when an update replaces it with one', async () => {
    const { cms, token } = await site();
    const url = await created(await postJson(cms, token, ROCKS_204));
    await updated(cms, token, { action: 'update', url, replace: { location: ['geo:1,2'] } });
    const properties = await source(cms, token, url);
    assert.deepEqual(properties['location'], ['geo:1,2']);
    assert.equal('checkin' in properties, false);
  });

  it('stays a checkin through an editor save, and goes when its box is unticked', async () => {
    const { cms, agent, token } = await site();
    const url = await created(
      await postJson(cms, token, {
        ...ROCKS_204,
        properties: { ...ROCKS_204.properties, 'mp-slug': ['lunch'] },
      }),
    );
    const permalink = new URL(url).pathname;
    const save = async (checkin: boolean): Promise<void> => {
      const page = await (await agent.get('/admin/posts/lunch')).text();
      assert.match(page, /name="location-checkin"/);
      const document = cms.store.getByPermalink(permalink);
      const csrf = csrfField(page);
      assert.ok(document !== undefined && csrf !== undefined);
      const date = /name="date"[^>]*value="([^"]*)"/.exec(page)?.[1];
      assert.ok(date !== undefined, 'the editor shows the date');
      const saved = await agent.post('/admin/posts/lunch', {
        csrf_token: csrf,
        slug: 'lunch',
        body: 'Lunch meeting',
        date,
        'location-name': 'Los Gorditos',
        'location-locality': 'Portland',
        ...(checkin ? { 'location-checkin': '1' } : {}),
        action: 'publish',
        hash: document.hash,
      });
      assert.equal(saved.status, 303, await saved.text());
    };

    await save(true);
    assert.deepEqual((await storedLocations(cms))[permalink], {
      name: 'Los Gorditos',
      locality: 'Portland',
      checkin: true,
    });
    assert.ok('checkin' in (await source(cms, token, url)));

    await save(false);
    assert.deepEqual((await storedLocations(cms))[permalink], {
      name: 'Los Gorditos',
      locality: 'Portland',
    });
    assert.ok('location' in (await source(cms, token, url)));
  });
});

describe('public surfaces (AC #3)', () => {
  it('with sharing off, nothing of the checkin reaches any public surface or file under content/', async () => {
    const { cms, token } = await site();
    const url = await created(await postJson(cms, token, ROCKS_204));
    const pathname = new URL(url).pathname;

    const surfaces: Record<string, string> = {
      page: await text(cms, pathname),
      markdown: await text(cms, pathname, 'text/markdown'),
      json: await text(cms, pathname, 'application/json'),
      rss: await text(cms, feedPathUnder('/', 'rss')),
      atom: await text(cms, feedPathUnder('/', 'atom')),
      jsonFeed: await text(cms, feedPathUnder('/', 'json')),
      activityStreams: await text(cms, pathname, 'application/activity+json'),
      oembed: await text(cms, `${OEMBED_PATH}?${new URLSearchParams({ url }).toString()}`),
      llms: await text(cms, '/llms.txt'),
      search: await text(cms, '/search/?q=Lunch'),
      searchJson: await text(cms, '/search/index.json?q=Lunch'),
      ...Object.fromEntries(
        (await filesUnder(cms.config.contentDir)).map(([file, contents]) => [
          `content/${file}`,
          contents,
        ]),
      ),
    };
    for (const name of ['page', 'markdown', 'json', 'rss', 'activityStreams', 'search']) {
      assert.match(surfaces[name] ?? '', /Lunch meeting/, `${name} carries the post`);
    }
    for (const [name, contents] of Object.entries(surfaces)) {
      for (const needle of SECRETS) {
        assert.ok(!contents.includes(needle), `${name} holds ${needle}`);
      }
    }
  });

  it('with place sharing, prints the venue as a p-location and nothing of the street, postcode or coordinates', async () => {
    const { cms, token } = await site('place');
    const url = await created(await postJson(cms, token, ROCKS_204));
    const pathname = new URL(url).pathname;
    const page = await text(cms, pathname);
    const object = await text(cms, pathname, 'application/activity+json');

    assert.match(page, /p-location[\s\S]*Los Gorditos/);
    assert.match(object, /"Place"/);
    for (const [name, contents] of Object.entries({ page, object })) {
      for (const needle of ['45.52433', '-122.68068', '922 NW Everett', '97209', 'foursquare']) {
        assert.ok(!contents.includes(needle), `${name} holds ${needle}`);
      }
    }
  });
});
