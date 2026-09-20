import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SiteData } from './context.ts';
import { navigationItems, navigationMenu, navigationMenus, siteMenus } from './navigation.ts';

describe('navigationMenu', () => {
  it('lists the items one named menu holds, in the order it names them (AC #1)', () => {
    const menu = navigationMenu({
      site: {
        title: 'A Site',
        url: 'https://example.com',
        menus: {
          primary: [
            { label: 'About', url: '/about/' },
            { label: 'Elsewhere', url: 'https://example.org/' },
          ],
        },
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
      menus: {
        primary: [
          { label: 'Home', url: '/' },
          { label: 'About', url: '/about' },
          { label: 'Elsewhere', url: 'https://example.org/' },
        ],
      },
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

  it('builds the menu the name asks for, and nothing for a name the site has not stored', () => {
    const site: SiteData = {
      title: 'A Site',
      url: 'https://example.com',
      menus: {
        primary: [{ label: 'About', url: '/about/' }],
        footer: [{ label: 'Colophon', url: '/colophon/' }],
      },
    };

    assert.deepEqual(
      navigationMenu({ site, url: '/', name: 'footer' }).map((item) => item.label),
      ['Colophon'],
    );
    assert.deepEqual(navigationMenu({ site, url: '/', name: 'sidebar' }), []);
  });

  it('has nothing in it for a site that has stored no menu at all', () => {
    assert.deepEqual(
      navigationMenu({ site: { title: 'A Site', url: 'https://example.com' }, url: '/' }),
      [],
    );
  });
});

describe('navigationMenus', () => {
  it('marks the current item of every stored menu, keyed by name (AC #5)', () => {
    const menus = navigationMenus({
      site: {
        title: 'A Site',
        url: 'https://example.com',
        menus: {
          primary: [
            { label: 'Home', url: '/' },
            { label: 'About', url: '/about/' },
          ],
          footer: [{ label: 'About', url: '/about/' }],
        },
      },
      url: '/about/',
    });

    assert.deepEqual(menus, {
      primary: [
        { label: 'Home', url: '/', current: false },
        { label: 'About', url: '/about/', current: true },
      ],
      footer: [{ label: 'About', url: '/about/', current: true }],
    });
  });

  it('carries a menu no theme has an area for, because the site still holds it (AC #6)', () => {
    const menus = navigationMenus({
      site: {
        title: 'A Site',
        url: 'https://example.com',
        menus: { sidebar: [{ label: 'Links', url: '/links/' }] },
      },
      url: '/',
    });

    assert.deepEqual(Object.keys(menus), ['sidebar']);
  });
});

describe('siteMenus', () => {
  it('reads nothing out of site data that stores no menus', () => {
    assert.deepEqual(siteMenus({ title: 'A Site', url: 'https://example.com' }), {});
  });

  it('no longer reads the navigation key TASK-106 left behind (AC #7)', () => {
    assert.deepEqual(
      siteMenus({
        title: 'A Site',
        url: 'https://example.com',
        navigation: [{ label: 'About', url: '/about/' }],
      }),
      {},
    );
  });

  it('reads nothing out of a menus key that is not an object of lists', () => {
    assert.deepEqual(
      siteMenus({ title: 'A Site', url: 'https://example.com', menus: 'About' }),
      {},
    );
    assert.deepEqual(siteMenus({ title: 'A Site', url: 'https://example.com', menus: [] }), {});
    assert.deepEqual(
      siteMenus({ title: 'A Site', url: 'https://example.com', menus: { primary: 'About' } }),
      { primary: [] },
      'a name that holds something other than a list is a menu with nothing in it',
    );
  });
});

describe('navigationItems', () => {
  it('reads the primary menu when nothing says which menu', () => {
    assert.deepEqual(
      navigationItems({
        title: 'A Site',
        url: 'https://example.com',
        menus: { primary: [{ label: 'About', url: '/about/' }] },
      }),
      [{ label: 'About', url: '/about/' }],
    );
  });

  it('drops what it cannot read rather than failing the render (AC #1)', () => {
    const items = navigationItems({
      title: 'A Site',
      url: 'https://example.com',
      menus: {
        primary: [
          { label: 'About', url: '/about/' },
          { label: '', url: '/nameless/' },
          { label: 'Nowhere' },
          'About',
          null,
          { label: 'Numbered', url: 7 },
        ],
      },
    });

    assert.deepEqual(items, [{ label: 'About', url: '/about/' }]);
  });

  it('reads the me flag, and only when it is spelled true (AC #2)', () => {
    const items = navigationItems({
      title: 'A Site',
      url: 'https://example.com',
      menus: {
        primary: [
          { label: 'Mastodon', url: 'https://example.social/@me', me: true },
          { label: 'About', url: '/about/' },
          { label: 'Unset', url: '/unset/', me: false },
          { label: 'Wordy', url: '/wordy/', me: 'yes' },
        ],
      },
    });

    assert.deepEqual(items, [
      { label: 'Mastodon', url: 'https://example.social/@me', me: true },
      { label: 'About', url: '/about/' },
      { label: 'Unset', url: '/unset/' },
      { label: 'Wordy', url: '/wordy/' },
    ]);
  });
});
