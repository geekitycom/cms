import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { externalLinks, ownSiteLinks, siteLinkKey } from './links.ts';

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

describe('ownSiteLinks', () => {
  const PAGE = 'https://blog.example/2026/09/hello/';

  it('names each page of the site a body links to as its path, however the link is spelled', () => {
    const html =
      '<a href="https://blog.example/2026/09/other/">absolute</a>' +
      '<a href="/2026/09/other">no slash</a>' +
      '<a href="/2026/09/other/?ref=feed#comments">query and fragment</a>' +
      '<a href="../another/">relative to the page</a>' +
      '<a href="/caf%C3%A9/">encoded</a>' +
      '<a href="https://elsewhere.example/2026/09/other/">theirs</a>' +
      '<a href="mailto:me@blog.example">mail</a>';

    assert.deepEqual(ownSiteLinks(html, PAGE, BASE), [
      { path: '/2026/09/other', query: '' },
      { path: '/2026/09/other', query: 'ref=feed' },
      { path: '/2026/09/another', query: '' },
      { path: '/café', query: '' },
    ]);
  });

  it('keeps the query, sorted as a redirect source is, so /?p=7 is not a link to /', () => {
    const html =
      '<a href="/?p=7">by id</a>' +
      '<a href="https://blog.example/?page_id=3&amp;a=1">a page by id</a>' +
      '<a href="/?p=7#respond">the same id</a>';

    assert.deepEqual(ownSiteLinks(html, PAGE, BASE), [
      { path: '/', query: 'p=7' },
      { path: '/', query: 'a=1&page_id=3' },
    ]);
  });

  it('reads a root-relative link under the directory a site is served from', () => {
    const base = 'https://example.org/blog/';
    const html =
      '<a href="/2026/09/other/">root-relative</a>' +
      '<a href="https://example.org/blog/about/">absolute</a>' +
      '<a href="https://example.org/elsewhere/">outside the site</a>';

    assert.deepEqual(ownSiteLinks(html, 'https://example.org/blog/2026/09/hello/', base), [
      { path: '/2026/09/other', query: '' },
      { path: '/about', query: '' },
    ]);
  });

  it('spells a permalink the way it spells a link to it', () => {
    assert.equal(siteLinkKey('/2026/09/other/'), '/2026/09/other');
    assert.equal(siteLinkKey('/2026/09/other'), '/2026/09/other');
    assert.equal(siteLinkKey('/'), '/');
  });
});
