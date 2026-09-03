import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DOCUMENT_REPRESENTATIONS,
  LISTING_REPRESENTATIONS,
  isNotModified,
  parseAccept,
  prefersActivityStreams,
  representationEtag,
  representationHref,
  selectRepresentation,
  splitRepresentationExtension,
} from './negotiate.ts';

describe('parseAccept', () => {
  it('reads media ranges and their q-values', () => {
    assert.deepEqual(parseAccept('text/html, application/json;q=0.4'), [
      { type: 'text', subtype: 'html', quality: 1 },
      { type: 'application', subtype: 'json', quality: 0.4 },
    ]);
  });

  it('lower-cases types and ignores parameters other than q', () => {
    assert.deepEqual(parseAccept('TEXT/Markdown; charset=UTF-8; q=0.7'), [
      { type: 'text', subtype: 'markdown', quality: 0.7 },
    ]);
  });

  it('skips junk rather than failing the request', () => {
    assert.deepEqual(parseAccept('text/html, , nonsense, /json, text/'), [
      { type: 'text', subtype: 'html', quality: 1 },
    ]);
  });

  it('clamps a q outside the grammar and treats an unreadable one as 1', () => {
    assert.deepEqual(
      parseAccept('a/b;q=5, c/d;q=-1, e/f;q=banana').map((range) => range.quality),
      [1, 0, 1],
    );
  });
});

describe('selectRepresentation', () => {
  it('gives HTML to a request that says nothing', () => {
    for (const accept of [undefined, '', '   ', '*/*', 'nonsense']) {
      assert.equal(selectRepresentation(accept, DOCUMENT_REPRESENTATIONS), 'html', String(accept));
    }
  });

  it('prefers the most specific match at the highest q', () => {
    assert.equal(
      selectRepresentation('*/*, application/json', DOCUMENT_REPRESENTATIONS),
      'json',
      'an exact type beats the wildcard it ties with',
    );
    assert.equal(
      selectRepresentation('text/*;q=0.9, application/json;q=0.4', DOCUMENT_REPRESENTATIONS),
      'html',
      'the higher q wins even against a more specific range',
    );
  });

  it('refuses what is not on offer', () => {
    assert.equal(selectRepresentation('image/png', DOCUMENT_REPRESENTATIONS), undefined);
    assert.equal(selectRepresentation('*/*;q=0', DOCUMENT_REPRESENTATIONS), undefined);
    assert.equal(
      selectRepresentation('text/markdown', LISTING_REPRESENTATIONS),
      undefined,
      'a listing has no Markdown to give',
    );
  });
});

describe('splitRepresentationExtension', () => {
  it('takes both spellings of the suffix off', () => {
    assert.deepEqual(splitRepresentationExtension('/2026/09/hello/index.md'), {
      representation: 'markdown',
      paths: ['/2026/09/hello/'],
    });
    assert.deepEqual(splitRepresentationExtension('/2026/09/hello.json'), {
      representation: 'json',
      paths: ['/2026/09/hello/', '/2026/09/hello'],
    });
    assert.deepEqual(splitRepresentationExtension('/index.json'), {
      representation: 'json',
      paths: ['/'],
    });
  });

  it('leaves anything else alone', () => {
    for (const pathname of ['/2026/09/hello/', '/notes.txt/', '/style.css', '/.md', '']) {
      assert.equal(splitRepresentationExtension(pathname), undefined, pathname);
    }
  });

  it('round-trips with representationHref', () => {
    for (const href of ['/2026/09/hello/', '/', '/tags/notes/']) {
      for (const representation of ['markdown', 'json'] as const) {
        const url = representationHref(href, representation);
        const split = splitRepresentationExtension(url);
        assert.equal(split?.representation, representation, url);
        assert.ok(split?.paths.includes(href), `${url} points back at ${href}`);
      }
    }
    assert.equal(representationHref('/x/', 'html'), '/x/', 'HTML is the canonical URL itself');
  });
});

describe('representationEtag', () => {
  it('is stable for the same content and different for each representation', () => {
    assert.equal(representationEtag('json', 'abc'), representationEtag('json', 'abc'));
    assert.notEqual(representationEtag('json', 'abc'), representationEtag('markdown', 'abc'));
    assert.notEqual(representationEtag('json', 'abc'), representationEtag('json', 'abd'));
    assert.match(representationEtag('html', 'abc'), /^"[0-9a-f]{32}"$/);
  });
});

describe('isNotModified', () => {
  const modified = new Date('2026-09-04T11:30:00Z');

  it('matches an ETag, including a weak one and a wildcard', () => {
    for (const ifNoneMatch of ['"tag"', 'W/"tag"', '*', '"other", "tag"']) {
      assert.equal(isNotModified({ ifNoneMatch }, '"tag"', modified), true, ifNoneMatch);
    }
    assert.equal(isNotModified({ ifNoneMatch: '"other"' }, '"tag"', modified), false);
  });

  it('lets If-None-Match settle it even when the timestamp would say otherwise', () => {
    const conditional = {
      ifNoneMatch: '"other"',
      ifModifiedSince: new Date('2026-09-05T00:00:00Z').toUTCString(),
    };

    assert.equal(isNotModified(conditional, '"tag"', modified), false);
  });

  it('compares If-Modified-Since at one-second resolution', () => {
    assert.equal(
      isNotModified({ ifModifiedSince: modified.toUTCString() }, undefined, modified),
      true,
      'the same second is unmodified',
    );
    assert.equal(
      isNotModified(
        { ifModifiedSince: new Date('2026-09-04T11:29:59Z').toUTCString() },
        undefined,
        modified,
      ),
      false,
    );
  });

  it('says nothing without a validator to compare', () => {
    assert.equal(isNotModified(undefined, '"tag"', modified), false);
    assert.equal(isNotModified({ ifNoneMatch: '*' }, undefined, modified), false);
    assert.equal(isNotModified({ ifModifiedSince: 'not a date' }, undefined, modified), false);
    assert.equal(
      isNotModified({ ifModifiedSince: modified.toUTCString() }, undefined, undefined),
      false,
    );
  });
});

describe('prefersActivityStreams', () => {
  it('is true when a peer asks for the ActivityStreams types by name', () => {
    assert.equal(prefersActivityStreams('application/activity+json'), true);
    assert.equal(
      prefersActivityStreams(
        'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      ),
      true,
    );
    // Mastodon sends both, and adds a wildcard behind them.
    assert.equal(
      prefersActivityStreams(
        'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams", text/html;q=0.1',
      ),
      true,
    );
  });

  it('is false for a browser, a feed reader, and a missing header', () => {
    assert.equal(
      prefersActivityStreams('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
      false,
    );
    assert.equal(prefersActivityStreams('text/html'), false);
    assert.equal(prefersActivityStreams('application/json'), false);
    assert.equal(prefersActivityStreams('*/*'), false);
    assert.equal(prefersActivityStreams(undefined), false);
    assert.equal(prefersActivityStreams('   '), false);
  });

  it('lets q-values decide when a request would take either', () => {
    assert.equal(prefersActivityStreams('text/html;q=0.5, application/activity+json'), true);
    assert.equal(prefersActivityStreams('text/html, application/activity+json;q=0.5'), false);
    // A tie goes to the document, so `application/*` still gets the JSON
    // representation rather than the object.
    assert.equal(prefersActivityStreams('application/*'), false);
  });

  it('is false when the ActivityStreams types are refused outright', () => {
    assert.equal(prefersActivityStreams('application/activity+json;q=0'), false);
  });
});
