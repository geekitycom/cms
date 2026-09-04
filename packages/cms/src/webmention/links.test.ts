import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { externalLinks } from './links.ts';

const BASE = 'https://blog.example';

describe('externalLinks', () => {
  it('finds the absolute links a rendered body points at', () => {
    const html = '<p>See <a href="https://elsewhere.example/post">this</a>.</p>';
    assert.deepEqual(externalLinks(html, BASE), ['https://elsewhere.example/post']);
  });

  it('leaves out links back to the site itself', () => {
    const html =
      '<p><a href="https://blog.example/2026/09/other/">mine</a> ' +
      '<a href="/2026/09/another/">also mine</a> ' +
      '<a href="https://elsewhere.example/">theirs</a></p>';
    assert.deepEqual(externalLinks(html, BASE), ['https://elsewhere.example/']);
  });

  it('names a target once however often the body links to it', () => {
    const html =
      '<a href="https://elsewhere.example/post">one</a>' +
      '<a href="https://elsewhere.example/post">two</a>';
    assert.deepEqual(externalLinks(html, BASE), ['https://elsewhere.example/post']);
  });

  it('leaves out a link that is not http', () => {
    const html = '<a href="mailto:someone@example.com">mail</a><a href="/feed/">feed</a>';
    assert.deepEqual(externalLinks(html, BASE), []);
  });

  it('drops the fragment, which is not part of what a target is', () => {
    const html = '<a href="https://elsewhere.example/post#section">there</a>';
    assert.deepEqual(externalLinks(html, BASE), ['https://elsewhere.example/post']);
  });
});
