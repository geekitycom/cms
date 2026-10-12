import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { knownEndpoint } from './oembed.ts';

describe('known oEmbed endpoints', () => {
  it('asks a known provider about one of its pages in JSON', () => {
    assert.deepEqual(knownEndpoint('https://youtu.be/dQw4w9WgXcQ'), {
      endpoint:
        'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ',
      titleSuffix: undefined,
    });
  });

  it('carries the title suffix the provider adds', () => {
    assert.equal(
      knownEndpoint('https://giphy.com/gifs/cat-abc123')?.titleSuffix,
      ' - Find & Share on GIPHY',
    );
  });

  it('leaves a provider page the endpoint does not answer for to the page', () => {
    assert.equal(knownEndpoint('https://www.youtube.com/@channel'), undefined);
    assert.equal(knownEndpoint('https://www.reddit.com/r/typescript/'), undefined);
  });

  it('knows nothing of another host', () => {
    assert.equal(knownEndpoint('https://example.com/watch?v=abc'), undefined);
  });
});
