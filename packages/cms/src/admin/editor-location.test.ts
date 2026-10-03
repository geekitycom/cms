import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { LOCATIONS_FILE, postLocations } from '../content/locations.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

async function admin(): Promise<{ cms: Cms; agent: Browser }> {
  const cms = await box.site();
  return { cms, agent: await signedIn(cms) };
}

async function token(agent: Browser, url: string): Promise<string> {
  const found = csrfField(await (await agent.get(url)).text());
  assert.ok(found !== undefined, `${url} carried a CSRF token`);
  return found;
}

function field(html: string, name: string): string | undefined {
  return new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html)?.[1];
}

const POST = {
  title: 'At the tower',
  slug: 'at-the-tower',
  date: '2026-09-02 09:00',
  body: 'Up the tower.',
  action: 'publish',
};

const FIELDS = {
  'location-geo': '48.85837, 2.29448',
  'location-accuracy': '50',
  'location-name': 'Eiffel Tower',
  'location-locality': 'Paris',
  'location-region': '',
  'location-country': 'France',
};

const STORED = {
  geo: { latitude: 48.85837, longitude: 2.29448, accuracy: 50 },
  name: 'Eiffel Tower',
  locality: 'Paris',
  country: 'France',
};

describe('the editor’s location fields', () => {
  it('writes the location to data/locations.json and nothing of it into the file', async () => {
    const { cms, agent } = await admin();

    const saved = await agent.post('/admin/posts/new', {
      csrf_token: await token(agent, '/admin/posts/new'),
      ...POST,
      ...FIELDS,
    });
    assert.equal(saved.status, 303);

    const document = cms.store.getBySlug('at-the-tower');
    assert.ok(document !== undefined);
    assert.deepEqual(postLocations(cms.config.dataDir).read(document.permalink), STORED);

    const file = await readFile(
      path.join(cms.config.contentDir, ...document.path.split('/')),
      'utf8',
    );
    for (const needle of ['48.85837', 'Eiffel', 'location', 'geo']) {
      assert.ok(!file.includes(needle), `the post file holds ${needle}`);
    }
  });

  it('shows the stored location back in its fields', async () => {
    const { agent } = await admin();
    await agent.post('/admin/posts/new', {
      csrf_token: await token(agent, '/admin/posts/new'),
      ...POST,
      ...FIELDS,
    });

    const html = await (await agent.get('/admin/posts/at-the-tower')).text();
    assert.equal(field(html, 'location-geo'), '48.85837, 2.29448');
    assert.equal(field(html, 'location-accuracy'), '50');
    assert.equal(field(html, 'location-name'), 'Eiffel Tower');
    assert.equal(field(html, 'location-locality'), 'Paris');
    assert.equal(field(html, 'location-region'), '');
    assert.equal(field(html, 'location-country'), 'France');
  });

  it('clears the location when every box is emptied', async () => {
    const { cms, agent } = await admin();
    await agent.post('/admin/posts/new', {
      csrf_token: await token(agent, '/admin/posts/new'),
      ...POST,
      ...FIELDS,
    });
    const document = cms.store.getBySlug('at-the-tower');
    assert.ok(document !== undefined);

    const cleared = await agent.post('/admin/posts/at-the-tower', {
      csrf_token: await token(agent, '/admin/posts/at-the-tower'),
      ...POST,
      action: 'update',
      hash: document.hash,
      'location-geo': '',
      'location-accuracy': '',
      'location-name': '',
      'location-locality': '',
      'location-region': '',
      'location-country': '',
    });
    assert.equal(cleared.status, 303);

    assert.equal(postLocations(cms.config.dataDir).read(document.permalink), undefined);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(cms.config.dataDir, LOCATIONS_FILE), 'utf8')),
      {},
    );
  });

  it('keeps a location whose fields were left as loaded, through a save of another field', async () => {
    const { cms, agent } = await admin();
    await agent.post('/admin/posts/new', {
      csrf_token: await token(agent, '/admin/posts/new'),
      ...POST,
      ...FIELDS,
    });
    const document = cms.store.getBySlug('at-the-tower');
    assert.ok(document !== undefined);

    const saved = await agent.post('/admin/posts/at-the-tower', {
      csrf_token: await token(agent, '/admin/posts/at-the-tower'),
      ...POST,
      ...FIELDS,
      title: 'Still at the tower',
      action: 'update',
      hash: document.hash,
    });
    assert.equal(saved.status, 303);
    assert.deepEqual(postLocations(cms.config.dataDir).read(document.permalink), STORED);
  });

  it('moves the location with a post whose slug is renamed', async () => {
    const { cms, agent } = await admin();
    await agent.post('/admin/posts/new', {
      csrf_token: await token(agent, '/admin/posts/new'),
      ...POST,
      ...FIELDS,
      draft: '1',
      action: 'save-draft',
    });
    const draft = cms.store.getBySlug('at-the-tower');
    assert.ok(draft !== undefined);

    const moved = await agent.post('/admin/posts/at-the-tower', {
      csrf_token: await token(agent, '/admin/posts/at-the-tower'),
      ...POST,
      ...FIELDS,
      slug: 'up-the-tower',
      draft: '1',
      action: 'save-draft',
      hash: draft.hash,
    });
    assert.equal(moved.status, 303);

    const renamed = cms.store.getBySlug('up-the-tower');
    assert.ok(renamed !== undefined);
    assert.notEqual(renamed.permalink, draft.permalink);
    const locations = postLocations(cms.config.dataDir);
    assert.deepEqual(locations.read(renamed.permalink), STORED);
    assert.equal(locations.read(draft.permalink), undefined);
  });

  it('refuses coordinates that are not a latitude and a longitude, naming the box', async () => {
    const { cms, agent } = await admin();

    for (const [geo, says] of [
      ['Paris', /Coordinates: needs both a latitude and a longitude/],
      ['Paris, France', /Coordinates: latitude has to be a number between -90 and 90/],
      ['95, 2', /Coordinates: latitude/],
      ['1, 181', /Coordinates: longitude/],
      ['48.8', /Coordinates: needs both a latitude and a longitude/],
      ['geo:48.8', /Coordinates as a geo: URI/],
    ] as const) {
      const refused = await agent.post('/admin/posts/new', {
        csrf_token: await token(agent, '/admin/posts/new'),
        ...POST,
        ...FIELDS,
        'location-geo': geo,
      });
      assert.equal(refused.status, 400, geo);
      assert.match(await refused.text(), says, geo);
    }
    const accuracy = await agent.post('/admin/posts/new', {
      csrf_token: await token(agent, '/admin/posts/new'),
      ...POST,
      ...FIELDS,
      'location-accuracy': 'close',
    });
    assert.equal(accuracy.status, 400);
    assert.match(await accuracy.text(), /Accuracy has to be a number of metres/);
    assert.equal(cms.store.getBySlug('at-the-tower'), undefined, 'nothing was written');
  });

  it('takes a geo: URI in the coordinates box, accuracy included', async () => {
    const { cms, agent } = await admin();
    const saved = await agent.post('/admin/posts/new', {
      csrf_token: await token(agent, '/admin/posts/new'),
      ...POST,
      'location-geo': 'geo:48.85837,2.29448;u=50',
    });
    assert.equal(saved.status, 303);
    const document = cms.store.getBySlug('at-the-tower');
    assert.ok(document !== undefined);
    assert.deepEqual(postLocations(cms.config.dataDir).read(document.permalink), {
      geo: { latitude: 48.85837, longitude: 2.29448, accuracy: 50 },
    });
  });
});
