/**
 * Micropub events (TASK-280): a client creates an h-event, reads it back with
 * q=source, and updates when and where it is, through the editor's own path.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import matter from 'gray-matter';

import { remoteHostsDoNotExist } from '../__testing__/offline.ts';
import { csrfField, FIRST_ADMIN, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { findUser } from '../admin/accounts.ts';
import { readSiteSettings, writeSiteJson } from '../admin/settings.ts';
import { postTypeOf } from '../content/post-type.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';

remoteHostsDoNotExist();

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

async function site(timezone = 'UTC'): Promise<Site> {
  const contentDir = await box.dir('geekity-micropub-event-content-');
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-micropub-event-data-'),
    baseUrl: BASE,
    now: () => NOW,
  });
  await writeSiteJson({ contentDir, settings: { ...readSiteSettings(contentDir), timezone } });
  const agent = await signedIn(cms);
  const ada = findUser(cms.config.dataDir, FIRST_ADMIN.username);
  assert.ok(ada !== undefined, 'the first admin exists');
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes: ['create', 'update'],
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

async function postForm(cms: Cms, token: string, fields: [string, string][]): Promise<Response> {
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields).toString(),
  });
}

async function created(response: Response): Promise<string> {
  assert.equal(response.status, 201, await response.clone().text());
  const location = response.headers.get('location');
  assert.ok(location !== null, 'a 201 names the post');
  return location;
}

async function refusal(response: Response): Promise<string> {
  assert.equal(response.status, 400);
  const body = (await response.json()) as Record<string, string>;
  assert.equal(body['error'], 'invalid_request');
  return body['error_description'] ?? '';
}

async function fileOf(cms: Cms, url: string): Promise<string> {
  const document = cms.store.getByPermalink(new URL(url).pathname);
  assert.ok(document !== undefined, `${url} is in the index`);
  return await readFile(path.join(cms.config.contentDir, ...document.path.split('/')), 'utf8');
}

async function postFiles(cms: Cms): Promise<string[]> {
  try {
    return await readdir(path.join(cms.config.contentDir, 'posts'));
  } catch {
    return [];
  }
}

async function source(cms: Cms, token: string, url: string): Promise<Record<string, unknown>> {
  const response = await cms.app.request(`${ENDPOINT}?q=source&url=${encodeURIComponent(url)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  return (await response.json()) as Record<string, unknown>;
}

const CAMP = {
  type: ['h-event'],
  properties: {
    name: ['IndieWeb Camp Chicago'],
    start: ['2026-10-10T09:00:00-05:00'],
    end: ['2026-10-10T17:00:00-05:00'],
    location: ['Chicago Public Library, 400 S State St'],
    content: ['Two days of building.'],
    category: ['indieweb'],
  },
};

describe('creating an event (AC #1)', () => {
  it('writes the same file the editor writes for the same event', async () => {
    const editorSite = await site('America/Chicago');
    const html = await (await editorSite.agent.get('/admin/posts/new')).text();
    const csrf = csrfField(html);
    assert.ok(csrf !== undefined);
    const saved = await editorSite.agent.post('/admin/posts/new', {
      csrf_token: csrf,
      title: 'IndieWeb Camp Chicago',
      date: '2026-09-19T09:00:00Z',
      tags: 'indieweb',
      'event-start': '2026-10-10 09:00',
      'event-end': '2026-10-10 17:00',
      'event-location': 'Chicago Public Library, 400 S State St',
      body: 'Two days of building.',
      action: 'publish',
    });
    assert.equal(saved.status, 303);

    const micropubSite = await site('America/Chicago');
    await created(
      await postJson(micropubSite.cms, micropubSite.token, {
        ...CAMP,
        properties: { ...CAMP.properties, published: ['2026-09-19T09:00:00Z'] },
      }),
    );

    const [editorFile] = await postFiles(editorSite.cms);
    const [micropubFile] = await postFiles(micropubSite.cms);
    assert.ok(editorFile !== undefined && micropubFile !== undefined);
    assert.equal(micropubFile, editorFile);
    const file = await readFile(
      path.join(micropubSite.cms.config.contentDir, 'posts', micropubFile),
      'utf8',
    );
    assert.equal(
      file,
      await readFile(path.join(editorSite.cms.config.contentDir, 'posts', editorFile), 'utf8'),
    );
    assert.match(file, /^start: '2026-10-10T14:00:00Z'$/m);
    assert.match(file, /^end: '2026-10-10T22:00:00Z'$/m);
  });

  it('makes an event of a form-encoded h=event, its page an h-event', async () => {
    const { cms, token } = await site();
    const location = await created(
      await postForm(cms, token, [
        ['h', 'event'],
        ['name', 'Launch party'],
        ['start', '2026-10-12T18:00:00Z'],
        ['location', 'https://meet.example/launch'],
      ]),
    );
    const document = cms.store.getByPermalink(new URL(location).pathname);
    assert.ok(document !== undefined);
    assert.equal(postTypeOf(document), 'event');
    assert.equal(document.extra['location'], 'https://meet.example/launch');
    const page = await (await cms.app.request(new URL(location).pathname)).text();
    assert.match(page, /h-event/);
    assert.match(page, /dt-start/);
  });

  it('reads an offset-less start in the site’s zone, as published is read', async () => {
    const { cms, token } = await site('America/Chicago');
    const location = await created(
      await postJson(cms, token, {
        type: ['h-event'],
        properties: { name: ['Meetup'], start: ['2026-10-10T09:00'] },
      }),
    );
    assert.equal(matter(await fileOf(cms, location)).data['start'], '2026-10-10T14:00:00Z');
  });

  it('keeps the author’s own location for a checkin and the event’s place for location', async () => {
    const { cms, token } = await site();
    const location = await created(
      await postJson(cms, token, {
        type: ['h-event'],
        properties: {
          name: ['Meetup'],
          start: ['2026-10-10T09:00:00Z'],
          location: ['The Library'],
          checkin: [{ type: ['h-card'], properties: { name: ['Cafe'], locality: ['Chicago'] } }],
        },
      }),
    );
    const document = cms.store.getByPermalink(new URL(location).pathname);
    assert.ok(document !== undefined);
    assert.equal(document.extra['location'], 'The Library');
    const locations = JSON.parse(
      await readFile(path.join(cms.config.dataDir, 'locations.json'), 'utf8'),
    ) as Record<string, { name?: string; checkin?: boolean }>;
    assert.equal(locations[document.permalink]?.name, 'Cafe');
    assert.equal(locations[document.permalink]?.checkin, true);

    const answer = (await source(cms, token, location))['properties'] as Record<string, unknown>;
    assert.deepEqual(answer['location'], ['The Library']);
    assert.ok(answer['checkin'] !== undefined, 'the checkin is answered as checkin');
  });

  for (const [label, place, words] of [
    [
      'an h-card naming a place',
      {
        type: ['h-card'],
        properties: {
          name: ['Chicago Public Library'],
          latitude: [41.876],
          longitude: [-87.628],
          'street-address': ['400 S State St'],
          locality: ['Chicago'],
          region: ['Illinois'],
          'country-name': ['US'],
        },
      },
      'Chicago Public Library, 400 S State St, Chicago, Illinois, US',
    ],
    [
      'an h-adr',
      {
        type: ['h-adr'],
        properties: { 'street-address': ['1 Main St'], locality: ['Springfield'] },
      },
      '1 Main St, Springfield',
    ],
    [
      'an h-card that is only an address',
      { type: ['h-card'], properties: { url: ['https://meet.example/room'] } },
      'https://meet.example/room',
    ],
  ] as const) {
    it(`writes ${label} as the event’s place in words, without its coordinates`, async () => {
      const { cms, token } = await site();
      const location = await created(
        await postJson(cms, token, {
          type: ['h-event'],
          properties: { name: ['Meetup'], start: ['2026-10-10T09:00:00Z'], location: [place] },
        }),
      );
      assert.equal(matter(await fileOf(cms, location)).data['location'], words);
    });
  }

  for (const [label, properties, named] of [
    ['an h-event with no start', { name: ['A party'] }, 'start'],
    [
      'an h-event with an unreadable start',
      { name: ['A party'], start: ['next tuesday'] },
      'Starts',
    ],
    [
      'an h-event ending before it starts',
      { name: ['A party'], start: ['2026-10-10T09:00:00Z'], end: ['2026-10-09T09:00:00Z'] },
      'cannot end before it starts',
    ],
    ['an h-event with no name', { start: ['2026-10-10T09:00:00Z'] }, 'name'],
    [
      'an h-event at a geo: URI',
      { name: ['A party'], start: ['2026-10-10T09:00:00Z'], location: ['geo:41.8,-87.6'] },
      'location',
    ],
    [
      'an h-event at an h-card that names nothing',
      {
        name: ['A party'],
        start: ['2026-10-10T09:00:00Z'],
        location: [{ type: ['h-card'], properties: { latitude: [41.8], longitude: [-87.6] } }],
      },
      'location',
    ],
  ] as const) {
    it(`refuses ${label}, naming it, and writes nothing`, async () => {
      const { cms, token } = await site();
      const response = await postJson(cms, token, { type: ['h-event'], properties });
      const description = await refusal(response);
      assert.ok(description.includes(named), description);
      assert.deepEqual(await postFiles(cms), []);
    });
  }

  it('refuses start on an h-entry, pointing at h-event', async () => {
    const { cms, token } = await site();
    const response = await postJson(cms, token, {
      type: ['h-entry'],
      properties: { content: ['Hi'], start: ['2026-10-10T09:00:00Z'] },
    });
    assert.match(await refusal(response), /h-event/);
    assert.deepEqual(await postFiles(cms), []);
  });
});

describe('reading an event back (AC #2)', () => {
  it('answers q=source with an h-event carrying its start, end and location', async () => {
    const { cms, token } = await site();
    const location = await created(await postJson(cms, token, CAMP));
    const answer = await source(cms, token, location);
    assert.deepEqual(answer['type'], ['h-event']);
    const properties = answer['properties'] as Record<string, unknown>;
    assert.deepEqual(properties['name'], ['IndieWeb Camp Chicago']);
    assert.deepEqual(properties['start'], ['2026-10-10T14:00:00Z']);
    assert.deepEqual(properties['end'], ['2026-10-10T22:00:00Z']);
    assert.deepEqual(properties['location'], ['Chicago Public Library, 400 S State St']);
    assert.deepEqual(properties['content'], ['Two days of building.']);
  });

  it('answers properties[] for an event without the type', async () => {
    const { cms, token } = await site();
    const location = await created(await postJson(cms, token, CAMP));
    const response = await cms.app.request(
      `${ENDPOINT}?q=source&url=${encodeURIComponent(location)}&properties[]=start`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.deepEqual(await response.json(), { properties: { start: ['2026-10-10T14:00:00Z'] } });
  });

  it('still answers an h-entry for a post that is no event', async () => {
    const { cms, token } = await site();
    const location = await created(
      await postJson(cms, token, { type: ['h-entry'], properties: { content: ['Hi'] } }),
    );
    const answer = await source(cms, token, location);
    assert.deepEqual(answer['type'], ['h-entry']);
    assert.equal('start' in (answer['properties'] as object), false);
  });

  it('takes its own q=source answer back as the same event', async () => {
    const first = await site();
    const location = await created(await postJson(first.cms, first.token, CAMP));
    const answer = await source(first.cms, first.token, location);

    const second = await site();
    const again = await created(await postJson(second.cms, second.token, answer));
    assert.equal(await fileOf(second.cms, again), await fileOf(first.cms, location));
  });
});

describe('updating an event', () => {
  async function update(cms: Cms, token: string, url: string, body: object): Promise<Response> {
    return await postJson(cms, token, { action: 'update', url, ...body });
  }

  it('replaces its start and keeps its end and place', async () => {
    const { cms, token } = await site();
    const location = await created(await postJson(cms, token, CAMP));
    const response = await update(cms, token, location, {
      replace: { start: ['2026-10-10T13:00:00Z'] },
    });
    assert.equal(response.status, 204, await response.clone().text());
    const { data } = matter(await fileOf(cms, location));
    assert.equal(data['start'], '2026-10-10T13:00:00Z');
    assert.equal(data['end'], '2026-10-10T22:00:00Z');
    assert.equal(data['location'], 'Chicago Public Library, 400 S State St');
  });

  it('moves it online by replacing its location, and deletes its end', async () => {
    const { cms, token } = await site();
    const location = await created(await postJson(cms, token, CAMP));
    const response = await update(cms, token, location, {
      replace: { location: ['https://meet.example/camp'] },
      delete: ['end'],
    });
    assert.equal(response.status, 204, await response.clone().text());
    const { data } = matter(await fileOf(cms, location));
    assert.equal(data['location'], 'https://meet.example/camp');
    assert.equal(data['end'], undefined);
    assert.equal(data['start'], '2026-10-10T14:00:00Z');
  });

  it('refuses an end before its start, with the editor’s message', async () => {
    const { cms, token } = await site();
    const location = await created(await postJson(cms, token, CAMP));
    const before = await fileOf(cms, location);
    const response = await update(cms, token, location, {
      replace: { end: ['2026-10-01T00:00:00Z'] },
    });
    assert.match(await refusal(response), /cannot end before it starts/);
    assert.equal(await fileOf(cms, location), before);
  });

  it('refuses deleting its start, and leaves it an event', async () => {
    const { cms, token } = await site();
    const location = await created(await postJson(cms, token, CAMP));
    const before = await fileOf(cms, location);
    const response = await update(cms, token, location, { delete: ['start'] });
    assert.match(await refusal(response), /needs a start/);
    assert.equal(await fileOf(cms, location), before);
  });

  it('refuses a start on a post that is no event, pointing at h-event', async () => {
    const { cms, token } = await site();
    const location = await created(
      await postJson(cms, token, { type: ['h-entry'], properties: { content: ['Hi'] } }),
    );
    const response = await update(cms, token, location, {
      replace: { start: ['2026-10-10T09:00:00Z'] },
    });
    assert.match(await refusal(response), /h-event/);
  });
});
