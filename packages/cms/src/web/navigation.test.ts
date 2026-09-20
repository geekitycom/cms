import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SiteData } from './context.ts';
import { navigationItems, navigationMenu } from './navigation.ts';

describe('navigationMenu', () => {
  it('lists the items the setting names, in the order it names them (AC #1)', () => {
    const menu = navigationMenu({
      site: {
        title: 'A Site',
        url: 'https://example.com',
        navigation: [
          { label: 'About', url: '/about/' },
          { label: 'Elsewhere', url: 'https://example.org/' },
        ],
      },
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
      navigationMenu({ site, url })
        .filter((item) => item.current)
        .map((item) => item.label);

    assert.deepEqual(current('/'), ['Home']);
    assert.deepEqual(current('/about/'), ['About']);
    assert.deepEqual(current('/about'), ['About']);
    assert.deepEqual(current('/2026/09/hello/'), [], 'a post is on no menu item');
    assert.deepEqual(current('https://example.org/'), [], 'a path is never an absolute URL');
  });

  it('has nothing in it for a site whose setting is empty', () => {
    assert.deepEqual(
      navigationMenu({ site: { title: 'A Site', url: 'https://example.com' }, url: '/' }),
      [],
    );
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
