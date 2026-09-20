import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SiteData } from './context.ts';
import {
  menuItemLineProblem,
  menuItemsFromText,
  menuItemsText,
  menuNameProblem,
  navigationItems,
  navigationMenu,
  navigationMenus,
  siteMenus,
} from './navigation.ts';

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

describe('menuNameProblem (TASK-108)', () => {
  it('takes the names a theme can write after a dot', () => {
    for (const name of ['primary', 'footer', 'top2', 'social_links', 'a']) {
      assert.equal(menuNameProblem(name), undefined, name);
    }
  });

  it('refuses a name a template could not loop over, and says why', () => {
    // `menus.top-bar` is `menus.top` minus `bar`, which renders nothing and
    // says nothing, so the name is refused here instead.
    assert.match(menuNameProblem('top-bar') ?? '', /letters, digits and underscores/);
    assert.match(menuNameProblem('2nd') ?? '', /start with a letter/);
    assert.match(menuNameProblem('') ?? '', /needs a name/);
    assert.match(menuNameProblem('   ') ?? '', /needs a name/);
    assert.ok(menuNameProblem('a'.repeat(33)) !== undefined, 'a name has a length');
  });

  it('refuses a capital rather than lowering it, because that is the confusable spelling', () => {
    // A stored `footer` and a stored `Footer` would be two menus nobody could
    // tell apart on the screen or in a theme; one spelling is the whole rule.
    assert.match(menuNameProblem('Footer') ?? '', /lower case/);
  });
});

describe('the Label | URL line format (TASK-108)', () => {
  it('reads one item per line, trimmed, blank lines skipped', () => {
    assert.deepEqual(
      menuItemsFromText('Home | /\n\n  About | /about/  \nElsewhere | https://example.org/'),
      [
        { label: 'Home', url: '/' },
        { label: 'About', url: '/about/' },
        { label: 'Elsewhere', url: 'https://example.org/' },
      ],
    );
  });

  it('reads a trailing flag, and only a flag this CMS has', () => {
    assert.deepEqual(menuItemsFromText('Mastodon | https://example.social/@me | me'), [
      { label: 'Mastodon', url: 'https://example.social/@me', me: true },
    ]);
    // A bar in the URL survives, because a trailing word that is not a flag is
    // part of the URL rather than a flag nobody asked for.
    assert.deepEqual(menuItemsFromText('Odd | /odd/?a=1|2'), [
      { label: 'Odd', url: '/odd/?a=1|2' },
    ]);
  });

  it('writes the items back as the lines they were typed as', () => {
    const text = 'Mastodon | https://example.social/@me | me\nAbout | /about/';
    assert.equal(menuItemsText(menuItemsFromText(text)), text);
  });

  it('refuses a URL with a space in it, whatever the URL parser makes of it (TASK-112)', () => {
    // `new URL('https://shll.me/@a | elsewhere')` does not throw: it takes the
    // space and the bar as path characters and percent-encodes them, so a
    // check that only asked the parser accepted the whole tail as a URL. A
    // typed URL has no spaces in it; a space means two things were typed.
    const trailing = 'Mastodon | https://shll.me/@a | elsewhere';

    assert.equal(menuItemsFromText(trailing).length, 0, 'the tail was read as a URL');
    assert.match(menuItemLineProblem(trailing) ?? '', /Label \| URL/);
    assert.match(menuItemLineProblem('About | /about page/') ?? '', /Label \| URL/);
    // And a bar with no space around it is still a URL character, which is
    // what the query-string case above depends on.
    assert.equal(menuItemLineProblem('Odd | /odd/?a=1|2'), undefined);
  });

  it('names the first line that is not an item, and says what one is', () => {
    for (const bad of ['About', 'About |', '| /about/', '  | ', 'About | not a url', 'me | me']) {
      assert.match(menuItemLineProblem(bad) ?? '', /Label \| URL/, JSON.stringify(bad));
      assert.match(menuItemLineProblem(bad) ?? '', /rel="me"/, JSON.stringify(bad));
    }
    assert.equal(menuItemLineProblem('Home | /\nAbout | /about/'), undefined);
    assert.equal(menuItemLineProblem(''), undefined, 'an empty menu is a menu');
  });
});
