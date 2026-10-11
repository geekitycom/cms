import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { absoluteUrl, withoutTrailingSlash, withTrailingSlash } from './url.ts';

describe('absoluteUrl', () => {
  it('keeps the path of a site served from a subdirectory', () => {
    assert.equal(
      absoluteUrl('/2026/09/hello/', 'https://example.com/blog/'),
      'https://example.com/blog/2026/09/hello/',
    );
    assert.equal(absoluteUrl('/x', 'https://example.com/blog'), 'https://example.com/blog/x');
  });

  it('treats a doubled trailing slash on the base as one', () => {
    assert.equal(absoluteUrl('/x', 'https://example.com/blog//'), 'https://example.com/blog/x');
    assert.equal(absoluteUrl('/x', 'https://example.com//'), 'https://example.com/x');
  });

  it('leaves an address that is already absolute alone', () => {
    assert.equal(
      absoluteUrl('https://elsewhere.example/a', 'https://example.com/blog/'),
      'https://elsewhere.example/a',
    );
  });
});

describe('the trailing-slash pair', () => {
  it('strips every trailing slash, not only the last', () => {
    assert.equal(withoutTrailingSlash('https://api.example/v1//'), 'https://api.example/v1');
    assert.equal(withoutTrailingSlash('https://api.example/v1'), 'https://api.example/v1');
  });

  it('ends a value in exactly one slash', () => {
    assert.equal(withTrailingSlash('https://example.com/blog//'), 'https://example.com/blog/');
    assert.equal(withTrailingSlash('https://example.com/blog'), 'https://example.com/blog/');
  });
});
