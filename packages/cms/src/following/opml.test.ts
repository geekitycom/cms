import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { opmlAlternate, parseOpml } from './opml.ts';

function fixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, '__fixtures__', name), 'utf8');
}

describe('parseOpml', () => {
  it('flattens a FreshRSS list, keeping each folder as a category and dropping frss:ttl', () => {
    assert.deepEqual(parseOpml(fixture('freshrss.opml')), {
      ok: true,
      feeds: [
        {
          text: 'Aaron Parecki',
          xmlUrl: 'https://aaronparecki.com/feed.xml',
          htmlUrl: 'https://aaronparecki.com/',
          description: "Aaron Parecki's notes & articles",
          category: '/Indieweb',
        },
        {
          text: 'Tantek',
          xmlUrl: 'https://tantek.com/updates.atom',
          htmlUrl: 'https://tantek.com/',
          category: '/Indieweb',
        },
        {
          text: 'Node.js Blog',
          xmlUrl: 'https://nodejs.org/en/feed/blog.xml',
          htmlUrl: 'https://nodejs.org/en/blog',
          description: 'News from the Node.js project',
          category: '/Software',
        },
      ],
    });
  });

  it('reads a flat list with no folders', () => {
    const flat = `<opml version="2.0"><head/><body>
      <outline text="One" type="rss" xmlUrl="https://one.example/feed"/>
      <outline text="Two" xmlUrl="http://two.example/rss" htmlUrl="http://two.example/"/>
    </body></opml>`;
    assert.deepEqual(parseOpml(flat), {
      ok: true,
      feeds: [
        { text: 'One', xmlUrl: 'https://one.example/feed' },
        { text: 'Two', xmlUrl: 'http://two.example/rss', htmlUrl: 'http://two.example/' },
      ],
    });
  });

  it('joins nested folders, drops repeats and non-web addresses, and falls back for a missing name', () => {
    assert.deepEqual(parseOpml(fixture('nested.opml')), {
      ok: true,
      feeds: [
        { text: 'Git news', xmlUrl: 'https://git.example/feed', category: '/Software/Tools' },
        {
          text: 'Rust',
          xmlUrl: 'https://rust.example/feed.xml',
          htmlUrl: 'https://rust.example/',
          category: '/Software',
        },
        { text: 'https://untitled.example/feed', xmlUrl: 'https://untitled.example/feed' },
        { text: 'Top level', xmlUrl: 'https://top.example/feed' },
      ],
    });
  });

  it('refuses XML that is not well formed', () => {
    const parsed = parseOpml('<opml version="2.0"><body><outline text="x"></body></opml>');
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? '' : parsed.problem, /not well-formed XML/);
  });

  it('refuses a document whose root is not <opml>', () => {
    assert.deepEqual(parseOpml('<rss version="2.0"><channel/></rss>'), {
      ok: false,
      problem: 'the root element is <rss>, not <opml>',
    });
  });

  it('refuses an OPML document with no body', () => {
    assert.deepEqual(parseOpml('<opml version="2.0"><head><title>x</title></head></opml>'), {
      ok: false,
      problem: 'the OPML has no <body>',
    });
  });
});

describe('opmlAlternate', () => {
  it('takes the first OPML alternate, resolved against the page address', () => {
    assert.equal(
      opmlAlternate(fixture('page.html'), 'https://public.example/index.opml'),
      'https://public.example/index.opml?format=opml',
    );
  });

  it('is undefined for a page that names none', () => {
    assert.equal(
      opmlAlternate(
        '<link rel="alternate" type="application/rss+xml" href="/feed">',
        'https://a.example/',
      ),
      undefined,
    );
  });
});
