import assert from 'node:assert/strict';
import { after, afterEach, describe, it } from 'node:test';

import type { HostLookup } from './public-address.ts';
import { fetchReplyContext } from './reply-context.ts';

const EVENT = 'https://events.example/2026/10/indieweb-camp';

const lookup: HostLookup = () => Promise.resolve(['203.0.113.9']);

let pages: Record<string, string> = {};

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const page = pages[new Request(input, init).url];
  return Promise.resolve(
    page === undefined
      ? new Response('missing', { status: 404 })
      : new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
  );
}) as typeof fetch;

after(() => {
  globalThis.fetch = original;
});

afterEach(() => {
  pages = {};
});

describe('an h-event', () => {
  it('gives its name, its start as an instant and its location', async () => {
    pages = {
      [EVENT]: `<!doctype html><title>Events</title>
        <div class="h-event">
          <h1 class="p-name">IndieWeb Camp Chicago</h1>
          <time class="dt-start" datetime="2026-10-10T09:00:00-05:00">10 October, 9am</time>
          <time class="dt-end" datetime="2026-10-11T17:00:00-05:00">to 5pm on the 11th</time>
          <span class="p-location h-card"><span class="p-name">Chicago Public Library</span>,
            <span class="p-locality">Chicago</span></span>
          <p class="p-summary">Two days of building your own website.</p>
        </div>`,
    };

    const fetched = await fetchReplyContext(EVENT, { lookup });

    assert.ok(fetched.ok);
    assert.deepEqual(fetched.context, {
      url: EVENT,
      name: 'IndieWeb Camp Chicago',
      text: 'Two days of building your own website.',
      start: '2026-10-10T14:00:00.000Z',
      location: 'Chicago Public Library',
    });
  });

  it('keeps a start with no zone as the date and time it is written, which the reader’s zone does not move', async () => {
    pages = {
      [EVENT]: `<div class="h-event"><span class="p-name">Homebrew Website Club</span>
        <time class="dt-start">2026-10-14 18:30</time>
        <span class="p-location">The usual café</span></div>`,
    };

    const fetched = await fetchReplyContext(EVENT, { lookup });

    assert.ok(fetched.ok);
    assert.equal(fetched.context.start, '2026-10-14T18:30');
    assert.equal(fetched.context.location, 'The usual café');
  });

  it('keeps a start that is only a date as the date', async () => {
    pages = {
      [EVENT]: `<div class="h-event"><span class="p-name">A day</span>
        <time class="dt-start" datetime="2026-10-14">14 October</time></div>`,
    };

    const fetched = await fetchReplyContext(EVENT, { lookup });

    assert.ok(fetched.ok);
    assert.equal(fetched.context.start, '2026-10-14');
  });

  it('leaves out a start that is no date', async () => {
    pages = {
      [EVENT]: `<div class="h-event"><span class="p-name">Someday</span>
        <span class="dt-start">soon</span></div>`,
    };

    const fetched = await fetchReplyContext(EVENT, { lookup });

    assert.ok(fetched.ok);
    assert.equal(fetched.context.name, 'Someday');
    assert.equal('start' in fetched.context, false);
  });
});

describe('a JSON-LD Event', () => {
  it('gives its name, its startDate and its location’s name', async () => {
    pages = {
      [EVENT]: `<!doctype html><title>Tickets | Somewhere</title>
        <script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Event',
          name: 'Fediverse meetup',
          startDate: '2026-11-02T19:00:00+01:00',
          location: { '@type': 'Place', name: 'De Balie', address: 'Amsterdam' },
        })}</script>`,
    };

    const fetched = await fetchReplyContext(EVENT, { lookup });

    assert.ok(fetched.ok);
    assert.equal(fetched.context.name, 'Fediverse meetup');
    assert.equal(fetched.context.start, '2026-11-02T18:00:00.000Z');
    assert.equal(fetched.context.location, 'De Balie');
  });

  it('reads a location given as text, and a VirtualLocation by its name', async () => {
    pages = {
      [EVENT]: `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Event',
        name: 'Online',
        startDate: '2026-11-02',
        location: [{ '@type': 'VirtualLocation', name: 'Jitsi' }],
      })}</script>`,
    };

    const fetched = await fetchReplyContext(EVENT, { lookup });

    assert.ok(fetched.ok);
    assert.equal(fetched.context.location, 'Jitsi');
    assert.equal(fetched.context.start, '2026-11-02');
  });
});

describe('a page that is no event', () => {
  it('gains neither field', async () => {
    pages = {
      [EVENT]: `<article class="h-entry"><h1 class="p-name">A post</h1>
        <div class="e-content">Words.</div></article>`,
    };

    const fetched = await fetchReplyContext(EVENT, { lookup });

    assert.ok(fetched.ok);
    assert.equal('start' in fetched.context, false);
    assert.equal('location' in fetched.context, false);
  });
});
