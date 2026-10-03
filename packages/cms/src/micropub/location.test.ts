import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { mf2 } from 'microformats-parser';

import { FIRST_ADMIN, sandbox, signedIn, signIn } from '../admin/__testing__/harness.ts';
import { saveSettings } from '../admin/__testing__/settings.ts';
import { findUser } from '../admin/accounts.ts';
import { updateSiteSettings } from '../admin/settings.ts';
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

const QUILL_GEO = 'geo:48.85837,2.29448;u=50';
const COORDINATES = ['48.85837', '2.29448'];

interface Site {
  cms: Cms;
  token: string;
}

async function site(sharing: LocationSharing = 'none'): Promise<Site> {
  const contentDir = await box.dir('geekity-micropub-location-content-');
  if (sharing !== 'none') {
    await updateSiteSettings({ contentDir, change: (s) => ({ ...s, locationSharing: sharing }) });
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-micropub-location-data-'),
    baseUrl: BASE,
    now: () => NOW,
  });
  await signedIn(cms);
  const ada = findUser(cms.config.dataDir, FIRST_ADMIN.username);
  assert.ok(ada !== undefined);
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://quill.p3k.io/',
      redirectUri: 'https://quill.p3k.io/auth/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes: ['create', 'update'],
    },
    NOW,
  );
  return { cms, token: accessToken };
}

async function postJson(cms: Cms, token: string, body: unknown): Promise<Response> {
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function quillNote(
  cms: Cms,
  token: string,
  content: string,
  geo = QUILL_GEO,
): Promise<string> {
  const response = await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      h: 'entry',
      access_token: token,
      content,
      location: geo,
    }).toString(),
  });
  return await created(response);
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

async function source(cms: Cms, token: string, url: string): Promise<Record<string, unknown[]>> {
  const response = await cms.app.request(`${ENDPOINT}?q=source&url=${encodeURIComponent(url)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  return ((await response.json()) as { properties: Record<string, unknown[]> }).properties;
}

async function storedLocations(cms: Cms): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(cms.config.dataDir, LOCATIONS_FILE), 'utf8'),
  ) as Record<string, unknown>;
}

async function filesUnder(root: string): Promise<[string, string][]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  const files = entries.filter((entry) => entry.isFile());
  return await Promise.all(
    files.map(async (entry): Promise<[string, string]> => {
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

function entryOf(html: string, url: string): Record<string, unknown[]> {
  const [entry] = mf2(html, { baseUrl: url }).items.filter((item) =>
    item.type?.includes('h-entry'),
  );
  assert.ok(entry !== undefined, 'the page has an h-entry');
  return entry.properties as Record<string, unknown[]>;
}

async function publicSurfaces(cms: Cms, url: string): Promise<Record<string, string>> {
  const pathname = new URL(url).pathname;
  const files = await filesUnder(cms.config.contentDir);
  return {
    page: await text(cms, pathname),
    markdown: await text(cms, pathname, 'text/markdown'),
    json: await text(cms, pathname, 'application/json'),
    rss: await text(cms, feedPathUnder('/', 'rss')),
    atom: await text(cms, feedPathUnder('/', 'atom')),
    jsonFeed: await text(cms, feedPathUnder('/', 'json')),
    activityStreams: await text(cms, pathname, 'application/activity+json'),
    oembed: await text(cms, `${OEMBED_PATH}?${new URLSearchParams({ url }).toString()}`),
    llms: await text(cms, '/llms.txt'),
    search: await text(cms, '/search/?q=Eiffel'),
    searchJson: await text(cms, '/search/index.json?q=Eiffel'),
    ...Object.fromEntries(files.map(([file, contents]) => [`content/${file}`, contents])),
  };
}

const PLACE = {
  type: ['h-card'],
  properties: {
    name: ['Eiffel Tower'],
    locality: ['Paris'],
    region: ['Île-de-France'],
    'country-name': ['France'],
    geo: [QUILL_GEO],
  },
};

describe('a Micropub location (AC #3)', () => {
  it('takes Quill’s geo: URI and keeps it under data/, not in the post', async () => {
    const { cms, token } = await site();
    const url = await quillNote(cms, token, 'At the tower.');
    const permalink = new URL(url).pathname;

    assert.deepEqual(await storedLocations(cms), {
      [permalink]: { geo: { latitude: 48.85837, longitude: 2.29448, accuracy: 50 } },
    });
    assert.equal((await stat(path.join(cms.config.dataDir, LOCATIONS_FILE))).mode & 0o777, 0o600);

    for (const [file, contents] of await filesUnder(cms.config.contentDir)) {
      for (const needle of [...COORDINATES, 'geo:', 'location']) {
        assert.ok(!contents.includes(needle), `${file} holds ${needle}`);
      }
    }
  });

  it('takes an h-geo, an h-adr and an h-card as JSON', async () => {
    const { cms, token } = await site();
    const geo = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: {
          content: ['Geo.'],
          location: [{ type: ['h-geo'], properties: { latitude: ['1.5'], longitude: ['2.5'] } }],
        },
      }),
    );
    const adr = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: {
          content: ['Adr.'],
          location: [
            { type: ['h-adr'], properties: { locality: ['Paris'], 'country-name': ['France'] } },
          ],
        },
      }),
    );
    const card = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: { content: ['Card.'], location: [PLACE] },
      }),
    );

    const stored = await storedLocations(cms);
    assert.deepEqual(stored[new URL(geo).pathname], { geo: { latitude: 1.5, longitude: 2.5 } });
    assert.deepEqual(stored[new URL(adr).pathname], { locality: 'Paris', country: 'France' });
    assert.deepEqual(stored[new URL(card).pathname], {
      geo: { latitude: 48.85837, longitude: 2.29448, accuracy: 50 },
      name: 'Eiffel Tower',
      locality: 'Paris',
      region: 'Île-de-France',
      country: 'France',
    });
  });

  it('refuses a malformed location by name and writes nothing', async () => {
    const { cms, token } = await site();
    const before = await readdir(path.join(cms.config.contentDir, 'posts')).catch(() => []);

    for (const [location, says] of [
      ['Paris', /location is a geo: URI/],
      ['geo:95,2', /location is a geo: URI/],
      [
        { type: ['h-geo'], properties: { latitude: ['95'], longitude: ['2'] } },
        /location latitude/,
      ],
      [{ type: ['h-adr'], properties: {} }, /location names no place and no coordinates/],
      [{ properties: { latitude: ['1'] } }, /h-geo, h-adr or h-card/],
    ] as const) {
      const response = await postJson(cms, token, {
        type: ['h-entry'],
        properties: { content: ['Where?'], location: [location] },
      });
      assert.match(await refusal(response), says, JSON.stringify(location));
    }
    const two = await postJson(cms, token, {
      type: ['h-entry'],
      properties: { content: ['Where?'], location: [QUILL_GEO, QUILL_GEO] },
    });
    assert.match(await refusal(two), /location takes one value/);

    assert.deepEqual(
      await readdir(path.join(cms.config.contentDir, 'posts')).catch(() => []),
      before,
    );
    await assert.rejects(stat(path.join(cms.config.dataDir, LOCATIONS_FILE)));
  });

  it('answers q=source with the location whatever the setting, and takes it back', async () => {
    const { cms, token } = await site();
    const url = await quillNote(cms, token, 'At the tower.');
    assert.deepEqual((await source(cms, token, url))['location'], [QUILL_GEO]);

    const card = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: { content: ['Card.'], location: [PLACE] },
      }),
    );
    const answered = (await source(cms, token, card))['location'];
    assert.deepEqual(answered, [PLACE]);

    const again = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: { content: ['Card again.'], location: answered },
      }),
    );
    const stored = await storedLocations(cms);
    assert.deepEqual(stored[new URL(again).pathname], stored[new URL(card).pathname]);
  });

  it('replaces and deletes the location on an update, leaving the rest alone', async () => {
    const { cms, token } = await site();
    const url = await quillNote(cms, token, 'At the tower.');
    const permalink = new URL(url).pathname;

    const replaced = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { location: [{ type: ['h-adr'], properties: { locality: ['Lyon'] } }] },
    });
    assert.equal(replaced.status, 204, await replaced.text());
    assert.deepEqual((await storedLocations(cms))[permalink], { locality: 'Lyon' });

    const retitled = await postJson(cms, token, {
      action: 'update',
      url,
      replace: { name: ['Named'] },
    });
    assert.equal(retitled.status, 204);
    assert.deepEqual((await storedLocations(cms))[permalink], { locality: 'Lyon' }, 'untouched');

    const deleted = await postJson(cms, token, { action: 'update', url, delete: ['location'] });
    assert.equal(deleted.status, 204);
    assert.equal(permalink in (await storedLocations(cms)), false);
    assert.equal('location' in (await source(cms, token, url)), false);
  });
});

describe('with sharing off, the default (AC #5)', () => {
  it('no part of the location reaches any public surface or any file under content/', async () => {
    const { cms, token } = await site();
    const url = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: { content: ['Up the Eiffel Tower today.'], location: [PLACE] },
      }),
    );

    const surfaces = await publicSurfaces(cms, url);
    assert.ok(Object.keys(surfaces).length > 11, 'the sweep covers the content files too');
    for (const [name, contents] of Object.entries(surfaces)) {
      for (const needle of [...COORDINATES, 'geo:', 'p-location', '"Place"', 'Île-de-France']) {
        assert.ok(!contents.includes(needle), `${name} holds ${needle}`);
      }
    }
    assert.equal('location' in entryOf(surfaces['page'] ?? '', url), false);
    const object = JSON.parse(surfaces['activityStreams'] ?? '{}') as Record<string, unknown>;
    assert.equal('location' in object, false);
  });
});

describe('with sharing on (AC #6)', () => {
  it('exact prints an h-geo p-location and federates a Place with the coordinates', async () => {
    const { cms, token } = await site('exact');
    const url = await quillNote(cms, token, 'At the tower.');

    const entry = entryOf(await text(cms, new URL(url).pathname), url);
    assert.deepEqual(entry['location'], [
      {
        type: ['h-geo'],
        properties: { latitude: ['48.85837'], longitude: ['2.29448'] },
        value: '48.85837, 2.29448',
      },
    ]);

    const object = JSON.parse(
      await text(cms, new URL(url).pathname, 'application/activity+json'),
    ) as Record<string, unknown>;
    assert.deepEqual(object['location'], {
      type: 'Place',
      latitude: 48.85837,
      longitude: 2.29448,
      accuracy: 50,
      units: 'm',
    });
  });

  it('exact prints a named place as an h-card with its words and coordinates', async () => {
    const { cms, token } = await site('exact');
    const url = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: { content: ['Card.'], location: [PLACE] },
      }),
    );

    const [location] = entryOf(await text(cms, new URL(url).pathname), url)['location'] ?? [];
    const card = location as { type: string[]; properties: Record<string, string[]> };
    assert.deepEqual(card.type, ['h-card']);
    assert.deepEqual(card.properties['name'], ['Eiffel Tower']);
    assert.deepEqual(card.properties['locality'], ['Paris']);
    assert.deepEqual(card.properties['region'], ['Île-de-France']);
    assert.deepEqual(card.properties['country-name'], ['France']);
    assert.deepEqual(card.properties['latitude'], ['48.85837']);
    assert.deepEqual(card.properties['longitude'], ['2.29448']);

    const object = JSON.parse(
      await text(cms, new URL(url).pathname, 'application/activity+json'),
    ) as Record<string, unknown>;
    assert.deepEqual(object['location'], {
      type: 'Place',
      name: 'Eiffel Tower, Paris, Île-de-France, France',
      latitude: 48.85837,
      longitude: 2.29448,
      accuracy: 50,
      units: 'm',
    });
  });

  it('place prints the words as an h-card and federates a named Place, and no coordinate anywhere', async () => {
    const { cms, token } = await site('place');
    const url = await created(
      await postJson(cms, token, {
        type: ['h-entry'],
        properties: { content: ['Card.'], location: [PLACE] },
      }),
    );

    const surfaces = await publicSurfaces(cms, url);
    for (const [name, contents] of Object.entries(surfaces)) {
      for (const needle of COORDINATES)
        assert.ok(!contents.includes(needle), `${name} holds ${needle}`);
    }
    const [location] = entryOf(surfaces['page'] ?? '', url)['location'] ?? [];
    const card = location as { type: string[]; properties: Record<string, string[]> };
    assert.deepEqual(card.type, ['h-card']);
    assert.deepEqual(card.properties['name'], ['Eiffel Tower']);
    assert.equal('latitude' in card.properties, false);

    const object = JSON.parse(surfaces['activityStreams'] ?? '{}') as Record<string, unknown>;
    assert.deepEqual(object['location'], {
      type: 'Place',
      name: 'Eiffel Tower, Paris, Île-de-France, France',
    });
  });

  it('place prints nothing for coordinates alone', async () => {
    const { cms, token } = await site('place');
    const url = await quillNote(cms, token, 'At the tower.');
    const pathname = new URL(url).pathname;

    assert.equal('location' in entryOf(await text(cms, pathname), url), false);
    const object = JSON.parse(await text(cms, pathname, 'application/activity+json')) as Record<
      string,
      unknown
    >;
    assert.equal('location' in object, false);
  });
});

describe('changing the setting (AC #7)', () => {
  it('takes effect on the next request for every post, without rewriting any post', async () => {
    const { cms, token } = await site();
    const first = await quillNote(cms, token, 'First.');
    const second = await quillNote(cms, token, 'Second.', 'geo:51.50073,-0.12463;u=10');
    const files = await filesUnder(cms.config.contentDir);
    const agent = await signIn(cms);

    for (const url of [first, second]) {
      assert.equal('location' in entryOf(await text(cms, new URL(url).pathname), url), false);
    }

    assert.equal((await saveSettings(agent, 'privacy', { location_sharing: 'exact' })).status, 303);

    assert.deepEqual(entryOf(await text(cms, new URL(first).pathname), first)['location'], [
      {
        type: ['h-geo'],
        properties: { latitude: ['48.85837'], longitude: ['2.29448'] },
        value: '48.85837, 2.29448',
      },
    ]);
    assert.deepEqual(entryOf(await text(cms, new URL(second).pathname), second)['location'], [
      {
        type: ['h-geo'],
        properties: { latitude: ['51.50073'], longitude: ['-0.12463'] },
        value: '51.50073, -0.12463',
      },
    ]);

    assert.equal((await saveSettings(agent, 'privacy', { location_sharing: 'none' })).status, 303);
    assert.equal('location' in entryOf(await text(cms, new URL(first).pathname), first), false);

    const after = await filesUnder(cms.config.contentDir);
    assert.deepEqual(
      after.filter(([file]) => file.startsWith('posts/')),
      files.filter(([file]) => file.startsWith('posts/')),
      'no post file changed',
    );
  });
});
