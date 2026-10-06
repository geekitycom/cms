import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { mf2 } from 'microformats-parser';

import { createUser, setUserProfile } from '../admin/accounts.ts';
import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';

function event(slug: string, frontMatter: string[], body: string): string {
  return [
    '---',
    "date: '2026-09-02T09:00:00Z'",
    `permalink: /2026/09/${slug}/`,
    'author: ada',
    ...frontMatter,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site', timezone: 'America/Chicago' }),
  'posts/camp.md': event(
    'camp',
    [
      'title: IndieWeb Camp Chicago',
      "start: '2026-10-10T14:00:00Z'",
      "end: '2026-10-10T22:00:00Z'",
      'location: Chicago Public Library, 400 S State St',
    ],
    'Two days of building our own websites.',
  ),
  'posts/club.md': event(
    'club',
    [
      'title: Homebrew Website Club',
      "start: '2026-10-14T00:30:00Z'",
      'location: https://meet.example/hwc',
    ],
    'Bring a site.',
  ),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-event-content-');
  const dataDir = await box.dir('geekity-event-data-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  await setUserProfile({ dataDir, userId: ada.id, profile: { displayName: 'Ada Lovelace' } });
  cms = await box.open({ contentDir, dataDir, baseUrl: BASE });
});

async function page(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `${pathname} answers`);
  return await response.text();
}

function hEvent(html: string, pathname: string): Record<string, unknown[]> {
  const items = mf2(html, { baseUrl: `${BASE}${pathname}` }).items;
  const found = items.find((item) => item.type?.includes('h-event'));
  assert.ok(found !== undefined, 'the page has an h-event');
  assert.equal(
    items.some((item) => item.type?.includes('h-entry')),
    false,
    'and no h-entry beside it',
  );
  return found.properties as Record<string, unknown[]>;
}

function graph(html: string): Record<string, unknown>[] {
  const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '{}';
  return (JSON.parse(json) as { '@graph': Record<string, unknown>[] })['@graph'];
}

function eventNode(html: string): Record<string, unknown> {
  const nodes = graph(html);
  const found = nodes.find((node) => node['@type'] === 'Event');
  assert.ok(found !== undefined, 'the graph has an Event');
  assert.equal(
    nodes.some((node) => node['@type'] === 'BlogPosting'),
    false,
    'in place of a BlogPosting',
  );
  return found;
}

describe('an event in the default theme (AC #1)', () => {
  it('is an h-event with its name, start, end, place and description', async () => {
    const html = await page('/2026/09/camp/');
    const properties = hEvent(html, '/2026/09/camp/');

    assert.deepEqual(properties['name'], ['IndieWeb Camp Chicago']);
    assert.deepEqual(properties['start'], ['2026-10-10T14:00:00.000Z']);
    assert.deepEqual(properties['end'], ['2026-10-10T22:00:00.000Z']);
    assert.deepEqual(properties['location'], ['Chicago Public Library, 400 S State St']);
    assert.deepEqual(properties['url'], [`${BASE}/2026/09/camp/`]);
    const [content] = properties['content'] as { value: string }[];
    assert.match(content?.value ?? '', /Two days of building our own websites\./);
  });

  it('shows the start and the end as the site’s clock reads them, and names the kind', async () => {
    const html = await page('/2026/09/camp/');
    assert.match(html, />\s*Event\s*</);
    assert.match(html, /10 October 2026 at 09:00 GMT-5/);
    assert.match(html, /10 October 2026 at 17:00 GMT-5/);
  });

  it('links where to join an online event, and has no end when it gives none', async () => {
    const html = await page('/2026/09/club/');
    const properties = hEvent(html, '/2026/09/club/');

    assert.deepEqual(properties['start'], ['2026-10-14T00:30:00.000Z']);
    assert.equal(properties['end'], undefined);
    assert.match(html, /<a class="p-location" href="https:\/\/meet\.example\/hwc">/);
    assert.match(html, /13 October 2026 at 19:30 GMT-5/);
  });
});

describe('an event’s JSON-LD (AC #5)', () => {
  it('is a schema.org Event at a place, organised by the author’s Person', async () => {
    const html = await page('/2026/09/camp/');
    const node = eventNode(html);

    assert.equal(node['name'], 'IndieWeb Camp Chicago');
    assert.equal(node['startDate'], '2026-10-10T14:00:00.000Z');
    assert.equal(node['endDate'], '2026-10-10T22:00:00.000Z');
    assert.deepEqual(node['location'], {
      '@type': 'Place',
      name: 'Chicago Public Library, 400 S State St',
      address: 'Chicago Public Library, 400 S State St',
    });
    assert.equal(node['eventAttendanceMode'], 'https://schema.org/OfflineEventAttendanceMode');
    assert.equal(node['eventStatus'], 'https://schema.org/EventScheduled');
    assert.equal(node['description'], 'Two days of building our own websites.');
    assert.equal(node['url'], `${BASE}/2026/09/camp/`);

    const person = graph(html).find((entry) => entry['@type'] === 'Person');
    assert.ok(person !== undefined, 'the graph has the author’s Person');
    assert.deepEqual(node['organizer'], { '@id': person['@id'] });
  });

  it('is online at a VirtualLocation, with no end when it gives none', async () => {
    const node = eventNode(await page('/2026/09/club/'));

    assert.deepEqual(node['location'], {
      '@type': 'VirtualLocation',
      url: 'https://meet.example/hwc',
    });
    assert.equal(node['eventAttendanceMode'], 'https://schema.org/OnlineEventAttendanceMode');
    assert.equal('endDate' in node, false);
  });
});
