/**
 * An RSVP's page (TASK-198 AC #1): a `p-rsvp` the h-entry carries, and the
 * event it answers cited as a `u-in-reply-to h-cite` with its name, its start
 * and its place. Asserted over HTTP against the default theme, because the
 * markup is the behaviour.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';

const box = sandbox();

const CAMP = 'https://events.example/2026/10/indieweb-camp';
const CLUB = 'https://events.example/2026/10/homebrew';
const COPY = 'https://silo.example/events/42';
const ORIGINAL = 'https://them.example/2026/10/party';

const PAGES: Record<string, string> = {
  [CAMP]: `<div class="h-event">
    <h1 class="p-name">IndieWeb Camp Chicago</h1>
    <time class="dt-start" datetime="2026-10-10T14:00:00Z">10 October</time>
    <span class="p-location h-card"><span class="p-name">Chicago Public Library</span></span>
  </div>`,
  [CLUB]: `<div class="h-event"><span class="p-name">Homebrew Website Club</span>
    <time class="dt-start">2026-10-14 00:30</time></div>`,
};

const lookup: HostLookup = () => Promise.resolve(['203.0.113.7']);

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  const page = PAGES[new Request(input).url];
  if (page === undefined) return Promise.reject(new TypeError('fetch failed'));
  return Promise.resolve(new Response(page, { headers: { 'content-type': 'text/html' } }));
}) as typeof fetch;

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
});

function rsvp(name: string, event: string, value: string, body = ''): string {
  return [
    '---',
    "date: '2026-09-10T09:00:00Z'",
    `permalink: /2026/09/${name}/`,
    `in-reply-to: ${event}`,
    `rsvp: ${value}`,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

async function get(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

function cite(html: string): string {
  const found = /<div class="[^"]*\bu-in-reply-to h-cite\b[^"]*">[\s\S]*?<\/div>/.exec(html)?.[0];
  assert.ok(found !== undefined, 'the page embeds an h-cite');
  return found;
}

describe('an RSVP in the default theme', () => {
  let cms: Cms;
  let contentDir: string;

  before(async () => {
    contentDir = await box.dir('geekity-rsvp-content-');
    const files: Record<string, string> = {
      // West of UTC, so a start written with no zone would move a day back if
      // it were read as UTC and shown in the site's zone.
      '_data/site.json': JSON.stringify({ title: 'A Site', timezone: 'America/Chicago' }),
      'posts/2026-09-10-camp.md': rsvp('camp', CAMP, 'yes', 'See you there.'),
      'posts/2026-09-10-club.md': rsvp('club', CLUB, 'interested'),
      'posts/2026-09-10-copy.md': rsvp('copy', COPY, 'yes'),
      '_data/replyContexts.json': JSON.stringify({
        [COPY]: { original: ORIGINAL, name: 'The party' },
      }),
    };
    for (const [relative, contents] of Object.entries(files)) {
      const file = path.join(contentDir, ...relative.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents, 'utf8');
    }
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      cms = await box.open({
        contentDir,
        dataDir: await box.dir('geekity-rsvp-data-'),
        hostLookup: lookup,
      });
      await cms.replyContexts.settled();
    } finally {
      console.warn = warn;
    }
  });

  it('keeps the event’s start and place in the reply contexts file', async () => {
    const stored = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'replyContexts.json'), 'utf8'),
    ) as Record<string, Record<string, unknown>>;
    assert.deepEqual(stored[CAMP], {
      url: CAMP,
      name: 'IndieWeb Camp Chicago',
      start: '2026-10-10T14:00:00.000Z',
      location: 'Chicago Public Library',
    });
    assert.equal(stored[CLUB]?.['start'], '2026-10-14T00:30');
  });

  it('carries a p-rsvp in its content and cites the event with its name, start and place', async () => {
    const html = await get(cms, '/2026/09/camp/');

    const content = /<section class="e-content">[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    assert.match(content, /<data class="p-rsvp" value="yes">Going<\/data>/);
    assert.match(html, /<span class="kicker-kind">RSVP<\/span>/);

    const citation = cite(html);
    assert.match(citation, /RSVP to/);
    assert.match(
      citation,
      new RegExp(`<a class="u-url p-name" href="${CAMP}">IndieWeb Camp Chicago</a>`),
    );
    assert.match(
      citation,
      /<time class="dt-start" datetime="2026-10-10T14:00:00.000Z">10 October 2026<\/time>/,
    );
    assert.match(citation, /<span class="p-location">Chicago Public Library<\/span>/);
  });

  it('shows a start written with no zone on the day it was written', async () => {
    const citation = cite(await get(cms, '/2026/09/club/'));

    assert.match(
      citation,
      /<time class="dt-start" datetime="2026-10-14T00:30">14 October 2026<\/time>/,
    );
    assert.doesNotMatch(citation, /p-location/);
  });

  it('names an RSVP with no words after the event, and carries its p-rsvp in a listing', async () => {
    const html = await get(cms, '/');
    const items = html.split('<article class="feed-item h-entry">');
    const club = items.find((each) => each.includes('href="/2026/09/club/"')) ?? '';

    assert.match(club, /<data class="p-rsvp" value="interested">Interested<\/data>/);
    assert.match(club, /<span class="kicker-kind">RSVP<\/span>/);
    assert.match(await get(cms, '/2026/09/club/'), /<title>Interested in Homebrew Website Club/);
  });

  it('cites the original of a silo copy of an event, as a reply does (TASK-197)', async () => {
    const html = await get(cms, '/2026/09/copy/');

    assert.match(
      cite(html),
      new RegExp(`<a class="u-url p-name" href="${ORIGINAL}">The party</a>`),
    );
    assert.match(html, new RegExp(`<a class="u-in-reply-to" href="${COPY}">`));
  });
});
