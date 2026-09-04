import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Document } from '../content/document.ts';
import type { SiteData } from './context.ts';
import { navigationItems, navigationMenu } from './navigation.ts';

/** A page as the index holds one, with whatever front matter a test names. */
function page(title: string, permalink: string, extra: Record<string, unknown> = {}): Document {
  return {
    type: 'page',
    path: `pages${permalink}index.md`,
    slug: title.toLowerCase(),
    permalink,
    title,
    tags: [],
    categories: [],
    draft: false,
    extra,
    body: '',
    html: '',
    hash: 'x',
  };
}

describe('navigationMenu', () => {
  it('lists the items the setting names, in the order it names them', () => {
    const menu = navigationMenu({
      site: {
        title: 'A Site',
        url: 'https://example.com',
        navigation: [
          { label: 'About', url: '/about/' },
          { label: 'Elsewhere', url: 'https://example.org/' },
        ],
      },
      pages: [],
      url: '/',
    });

    assert.deepEqual(menu, [
      { label: 'About', url: '/about/', current: false },
      { label: 'Elsewhere', url: 'https://example.org/', current: false },
    ]);
  });

  it('marks the item the request is on, trailing slash or not', () => {
    const site: SiteData = {
      title: 'A Site',
      url: 'https://example.com',
      navigation: [
        { label: 'Home', url: '/' },
        { label: 'About', url: '/about' },
        { label: 'Elsewhere', url: 'https://example.org/' },
      ],
    };

    const current = (url: string): string[] =>
      navigationMenu({ site, pages: [], url })
        .filter((item) => item.current)
        .map((item) => item.label);

    assert.deepEqual(current('/'), ['Home']);
    assert.deepEqual(current('/about/'), ['About']);
    assert.deepEqual(current('/about'), ['About']);
    assert.deepEqual(current('/2026/09/hello/'), [], 'a post is on no menu item');
    assert.deepEqual(current('https://example.org/'), [], 'a path is never an absolute URL');
  });

  it('adds the pages that opted in after the items, ordered then titled', () => {
    const menu = navigationMenu({
      site: {
        title: 'A Site',
        url: 'https://example.com',
        navigation: [{ label: 'Home', url: '/' }],
      },
      pages: [
        page('Uses', '/uses/', { navigation: true }),
        page('Colophon', '/colophon/', { navigation: true, navigationOrder: 2 }),
        page('Now', '/now/', { navigation: true, navigationOrder: 1 }),
        page('About', '/about/', { navigation: true }),
        page('Secret', '/secret/', {}),
        page('Also secret', '/also-secret/', { navigation: 'yes' }),
      ],
      url: '/now/',
    });

    assert.deepEqual(
      menu.map((item) => item.label),
      ['Home', 'Now', 'Colophon', 'About', 'Uses'],
    );
    assert.deepEqual(
      menu.filter((item) => item.current).map((item) => item.label),
      ['Now'],
      'a page in the menu is marked when it is the page being read',
    );
    assert.equal(menu[1]?.url, '/now/', 'a page links to its own permalink');
  });
});

describe('navigationItems', () => {
  it('reads nothing out of site data that names no menu', () => {
    assert.deepEqual(navigationItems({ title: 'A Site', url: 'https://example.com' }), []);
  });

  it('drops what it cannot read rather than failing the render', () => {
    const items = navigationItems({
      title: 'A Site',
      url: 'https://example.com',
      navigation: [
        { label: 'About', url: '/about/' },
        { label: '', url: '/nameless/' },
        { label: 'Nowhere' },
        'About',
        null,
        { label: 'Numbered', url: 7 },
      ],
    });

    assert.deepEqual(items, [{ label: 'About', url: '/about/' }]);
  });

  it('reads nothing out of a navigation key that is not a list', () => {
    assert.deepEqual(
      navigationItems({ title: 'A Site', url: 'https://example.com', navigation: 'About' }),
      [],
    );
  });
});
