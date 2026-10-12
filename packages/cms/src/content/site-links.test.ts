import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseRedirects } from './redirects.ts';
import {
  landing,
  linksInto,
  ownSiteLinks,
  siteLinkAt,
  siteLinkKey,
  spelling,
} from './site-links.ts';

const BASE = 'https://blog.example';

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

describe('siteLinkAt', () => {
  const PAGE = 'https://blog.example/2026/09/hello/';

  it('is one href as the link to this site it is, or nothing off the site', () => {
    assert.deepEqual(siteLinkAt('/about/?b=2&a=1#x', PAGE, BASE), {
      path: '/about',
      query: 'a=1&b=2',
    });
    assert.deepEqual(siteLinkAt('../other/', PAGE, BASE), { path: '/2026/09/other', query: '' });
    assert.equal(siteLinkAt('https://elsewhere.example/about/', PAGE, BASE), undefined);
    assert.equal(siteLinkAt('mailto:me@blog.example', PAGE, BASE), undefined);
    assert.equal(siteLinkAt(undefined, PAGE, BASE), undefined);
  });

  it('spells a link as its path, with its query when it has one', () => {
    assert.equal(spelling({ path: '/about', query: '' }), '/about');
    assert.equal(spelling({ path: '/', query: 'p=7' }), '/?p=7');
  });
});

describe('the links that land on a document', () => {
  const { table } = parseRedirects([
    {
      path: 'redirects.json',
      text: JSON.stringify([
        { from: '/old/', to: '/new/' },
        { from: '/older/', to: '/old/' },
        { from: '/?p=7', to: '/new/' },
        { from: '/?p=8', to: '/elsewhere/' },
        { from: '/shadowed/', to: '/new/' },
        { from: '/away/', to: 'https://example.org/' },
      ]),
    },
  ]);
  const live = new Set(['/new', '/shadowed', '/elsewhere']);
  const answers = (sitePath: string) => live.has(sitePath);

  it('walks back through every redirect that ends here, leaving out one a live page shadows', () => {
    const into = linksInto(table, ['/new', '/'], answers);
    assert.deepEqual(into.paths.sort(), ['/', '/new', '/old', '/older']);
    assert.deepEqual(into.queries, [{ path: '/', query: 'p=7' }]);
    assert.deepEqual(into.intercepted, ['/?p=8']);
  });

  it('follows a link forwards the way a request is answered', () => {
    assert.equal(landing(table, { path: '/older', query: '' }, answers), '/new');
    assert.equal(landing(table, { path: '/', query: 'p=7' }, answers), '/new');
    assert.equal(landing(table, { path: '/shadowed', query: '' }, answers), '/shadowed');
    assert.equal(landing(table, { path: '/away', query: '' }, answers), undefined);
  });
});
