import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { sandbox } from './__testing__/harness.ts';
import { remainingScreens } from './__testing__/remaining-screens.ts';
import type { RemainingScreen } from './__testing__/remaining-screens.ts';
import { ADMIN_TEMPLATES, createAdminTemplateEnvironment } from './templates.ts';

/**
 * The admin's remaining screens (decision-30, TASK-274): comments and
 * messages, themes, menus, the settings panels, the tools, the IndieAuth
 * consent and refused screens, the error page, the placeholder and the user
 * forms, each drawn from cards, tables, tabs and badges, and each saying what
 * it has to say.
 */

const box = sandbox();
after(() => box.cleanup());

/** The screen itself: what is inside `<main>`. */
function screenOf(html: string): string {
  return /<main\b[\s\S]*<\/main>/.exec(html)?.[0] ?? '';
}

/** Markup as the words it reads as. */
function text(html: string): string {
  return html
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll(/&amp;/g, '&')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** Every class token outside the admin bar, whose shadow root keeps classes of its own. */
function classesOutsideTheBar(html: string): string[] {
  const page = html.replace(/<geekity-admin-bar\b[\s\S]*<\/geekity-admin-bar>/, '');
  return [...page.matchAll(/\bclass="([^"]*)"/g)].flatMap(([, value]) =>
    (value ?? '').split(/\s+/).filter(Boolean),
  );
}

/** Each card on the screen, from its opening tag to the next card's. */
function cards(html: string): string[] {
  return screenOf(html)
    .split(/<div class="card bg-base-100 shadow-sm[^"]*">/)
    .slice(1);
}

/** The title a card is headed with, whether a `card-title` heading or the page's own. */
function cardTitle(card: string): string {
  return text(/<h[12] class="card-title[^"]*">([\s\S]*?)<\/h[12]>/.exec(card)?.[1] ?? '');
}

/** Every badge in some markup: its words and the classes after `badge`. */
function badges(html: string): { label: string; modifiers: string }[] {
  return [...html.matchAll(/<span class="badge((?: [\w-]+)*)">([^<]*)<\/span>/g)].map(
    ([, modifiers, label]) => ({ label: label ?? '', modifiers: (modifiers ?? '').trim() }),
  );
}

/** The tabs a screen draws: each link's words, and whether it is the current one. */
function tabs(html: string): { label: string; current: boolean }[] {
  const nav = /<nav class="tabs tabs-box" aria-label="[^"]+">([\s\S]*?)<\/nav>/.exec(html);
  assert.ok(nav, 'the filters are a labelled tabs nav');
  return [
    ...(nav[1] ?? '').matchAll(
      /<a class="tab( tab-active)?" href="[^"]*"( aria-current="page")?>([^<]*)<\/a>/g,
    ),
  ].map(([, active, current, label]) => {
    assert.equal(
      active !== undefined,
      current !== undefined,
      `${label} is marked for both eye and ear`,
    );
    return { label: (label ?? '').trim(), current: current !== undefined };
  });
}

/** The pagination macro's group, or `''` when the screen has none. */
function pagination(html: string): string {
  return (
    /<nav aria-label="Pages">\s*<div class="join">([\s\S]*?)<\/div>\s*<\/nav>/.exec(html)?.[1] ?? ''
  );
}

/** What each screen must say: the content the redraw had to keep. */
const WORDS: Record<RemainingScreen, readonly string[]> = {
  comments: [
    'Pending (2)',
    'Approved (26)',
    'Spam (1)',
    'Ada Lovelace',
    'https://ada.example/',
    'ada@example.com',
    'Good post.',
    'Hello world',
    'deadbeef',
    'Remote Blog',
    'webmention',
    'Linked here.',
    'Approve',
    'Spam',
    'Delete',
    'Reply',
    'Post reply',
  ],
  commentsApproved: ['Reader 26', 'a reply to another comment', 'Page 1 of 2', 'Older'],
  commentsSpam: ['Pill Seller', 'Buy pills.', 'Approve'],
  messages: [
    'Inbox (26)',
    'Spam (1)',
    'Grace Hopper',
    'grace@example.com',
    'About the compiler',
    'It is a lovely machine.',
    'Say hello',
    'unread',
    'Mark read',
    'Mark unread',
    'Page 1 of 2',
  ],
  messagesSpam: ['Pill Seller', 'Cheap pills', 'spam'],
  themes: [
    'Default',
    'Midnight',
    'Dark, quiet, and mostly type.',
    'midnight',
    'Active',
    'Activate',
    'Not themes',
    'broken',
  ],
  navigation: [
    'menus.primary',
    'menus.footer',
    'menus.top_bar',
    'About | /about/',
    'Kept, rendered nowhere',
    'Delete this menu',
    'Add a menu',
    'Add menu',
  ],
  navigationRefused: ['Nothing was saved', 'Top-Bar'],
  settingsGeneral: ['Title', 'Site icon', 'The site has no icon yet', 'Save settings'],
  settingsReading: ['Your homepage displays', 'Crawlers', 'Serve /llms.txt'],
  settingsPermalinks: ['Tag base', 'Archive redirects', 'misc', 'general'],
  settingsDiscussion: [
    'Webmentions',
    'Keeping personal data',
    'Spam checking',
    'Akismet does not recognise this key',
    'Replace key',
    'Remove key',
  ],
  settingsEmail: [
    'Security contact',
    'Mail credentials',
    'Configured',
    'A Brevo API key',
    'Also stored',
    'ending …1234',
    'Save credentials',
    'Remove credentials',
    'Send test email',
  ],
  settingsPrivacy: ['Location on posts', 'Uploads'],
  federationSettings: [
    'Relays',
    'WordPress paths',
    'wp-json/activitypub/1.0/actors/2/inbox',
    'Never',
  ],
  tools: ['Documents', 'Followers', 'Inbox activities', 'Comments', 'Rebuild the index'],
  toolsConfirm: ['Rebuild the index now?', 'Rebuild it', 'Cancel'],
  personalData: ['Email address', 'Look for it'],
  personalDataFound: ['What this site holds for ada@example.com', 'Erase it', 'Cancel'],
  usersEdit: [
    'Edit ada',
    'Back to all users',
    'Account',
    'Profile',
    'Email ada about',
    'Connected apps',
    'Change your password',
    'Delete',
  ],
  usersEditOther: ['Edit grace', 'Delete grace'],
  usersNew: ['Add new user', 'Username', 'optional', 'Add user'],
  consent: [
    'Sign in to https://app.example/?',
    'Sends you back to',
    'app.example',
    'Signs you in as',
    'It also asks for',
    'Approve',
    'Deny',
  ],
  refused: ['This sign-in cannot go ahead', 'has not published as its own'],
  error: ['Something went wrong', 'dashboard'],
};

const SCREENS = Object.keys(WORDS) as RemainingScreen[];

describe('the remaining screens', async () => {
  const served = await remainingScreens(box);

  for (const screen of SCREENS) {
    describe(screen, () => {
      it('says what it has to say', () => {
        const words = text(served[screen]).toLowerCase();
        for (const phrase of WORDS[screen]) {
          assert.ok(words.includes(phrase.toLowerCase()), phrase);
        }
      });

      it('carries no admin-* class outside the bar (AC #4)', () => {
        assert.deepEqual(
          classesOutsideTheBar(served[screen]).filter((token) => token.startsWith('admin-')),
          [],
        );
      });

      it('draws every table through the table macro, caption first', () => {
        const page = screenOf(served[screen]);
        const opened = [...page.matchAll(/<table\b[^>]*>/g)].length;
        const drawn = [
          ...page.matchAll(
            /<div class="max-w-full overflow-x-auto contain-inline-size">\s*<table class="table table-sm">\s*<caption class="sr-only">[^<]+<\/caption>/g,
          ),
        ].length;
        assert.equal(drawn, opened);
      });

      it('has at most one alert, ahead of any field that takes focus', () => {
        const page = served[screen];
        const alerts = [...page.matchAll(/role="alert"/g)].map((match) => match.index);
        assert.ok(alerts.length <= 1, `${String(alerts.length)} alerts`);
        const focus = /\sautofocus\b/.exec(page.replace(/role="alert"[^>]*autofocus/, ''));
        if (alerts[0] !== undefined && focus !== null) assert.ok(alerts[0] < focus.index);
      });
    });
  }

  describe('comments (AC #1)', () => {
    const rows = cards(served.comments);

    it('draws each comment as a card with its author line, where line, body and actions', () => {
      assert.equal(rows.length, 2);
      const ada = rows.find((row) => row.includes('Ada Lovelace'));
      const remote = rows.find((row) => row.includes('Remote Blog'));
      assert.match(ada ?? '', /Ada Lovelace[\s\S]*ada@example\.com/);
      assert.match(ada ?? '', /Hello world[\s\S]*deadbeef/);
      assert.match(ada ?? '', /<p>Good post\.<\/p>/);
      for (const action of ['approve', 'spam', 'delete']) {
        assert.match(
          ada ?? '',
          new RegExp(`<button type="submit" class="btn[^"]*" name="action" value="${action}">`),
          action,
        );
      }
      assert.match(remote ?? '', /Remote Blog/);
    });

    it('prints each comment’s state and source as a badge with its word', () => {
      const ada = rows.find((row) => row.includes('Ada Lovelace')) ?? '';
      const remote = rows.find((row) => row.includes('Remote Blog')) ?? '';
      assert.deepEqual(badges(ada), [{ label: 'Pending', modifiers: 'badge-sm badge-warning' }]);
      assert.deepEqual(badges(remote), [
        { label: 'Pending', modifiers: 'badge-sm badge-warning' },
        { label: 'Webmention', modifiers: 'badge-outline badge-sm' },
      ]);
      assert.deepEqual(badges(cards(served.commentsSpam)[0] ?? ''), [
        { label: 'Spam', modifiers: 'badge-sm badge-error' },
      ]);
    });

    it('folds the reply box into a details collapse, closed until opened', () => {
      for (const row of rows) {
        const reply =
          /<details class="collapse[^"]*"( open)?>\s*<summary class="collapse-title[^"]*">Reply<\/summary>([\s\S]*?)<\/details>/.exec(
            row,
          );
        assert.ok(reply, 'the reply box is a collapse');
        assert.equal(reply[1], undefined, 'and it starts folded');
        assert.match(reply[2] ?? '', /<form method="post" action="\/admin\/comments\/reply">/);
        assert.match(reply[2] ?? '', /<textarea id="reply-\d+" name="body"[^>]* required/);
      }
    });

    it('draws the pending / approved / spam filters as tabs, the current one marked (TASK-272 AC #2)', () => {
      assert.deepEqual(tabs(served.comments), [
        { label: 'Pending (2)', current: true },
        { label: 'Approved (26)', current: false },
        { label: 'Spam (1)', current: false },
      ]);
      assert.deepEqual(
        tabs(served.commentsSpam).map((tab) => tab.current),
        [false, false, true],
      );
    });

    it('pages through comments with the pagination macro (TASK-272 AC #2)', () => {
      const group = pagination(served.commentsApproved);
      assert.match(group, /aria-current="page">Page 1 of 2<\/span>/);
      assert.match(
        group,
        /<a class="join-item btn btn-sm" rel="next" href="\/admin\/comments\?status=approved&amp;page=2">Older<\/a>/,
      );
    });
  });

  describe('messages (AC #1)', () => {
    const rows = cards(served.messages);

    it('draws each message as a card with its author line, where line, body and actions', () => {
      assert.equal(rows.length, 25);
      const [first] = rows;
      assert.match(first ?? '', /Grace Hopper[\s\S]*href="mailto:grace@example\.com"/);
      assert.match(first ?? '', /from[\s\S]*Say hello/);
      assert.match(first ?? '', /About the compiler/);
      assert.match(first ?? '', /It is a lovely machine\.\nPlease write back\./);
      assert.match(first ?? '', /<a class="btn[^"]*" href="mailto:[^"]+">Reply<\/a>/);
      assert.match(first ?? '', /<button type="submit" class="btn[^"]*"[^>]*>Mark read<\/button>/);
      assert.match(first ?? '', /<button type="submit" class="btn[^"]*"[^>]*>Delete<\/button>/);
    });

    it('marks unread by a badge word and a heavier name, not by colour alone', () => {
      const [unread, read] = rows;
      assert.deepEqual(badges(unread ?? ''), [
        { label: 'Unread', modifiers: 'badge-sm badge-primary' },
      ]);
      assert.match(unread ?? '', /<span class="font-bold">Grace Hopper<\/span>/);
      assert.deepEqual(badges(read ?? ''), []);
      assert.match(read ?? '', /<span class="font-medium">Grace Hopper<\/span>/);
    });

    it('draws the inbox / spam filters as tabs and pages with the pagination macro (TASK-272 AC #2)', () => {
      assert.deepEqual(tabs(served.messages), [
        { label: 'Inbox (26)', current: true },
        { label: 'Spam (1)', current: false },
      ]);
      assert.deepEqual(tabs(served.messagesSpam), [
        { label: 'Inbox (26)', current: false },
        { label: 'Spam (1)', current: true },
      ]);
      assert.deepEqual(badges(cards(served.messagesSpam)[0] ?? ''), [
        { label: 'Unread', modifiers: 'badge-sm badge-primary' },
        { label: 'Spam', modifiers: 'badge-sm badge-error' },
      ]);
      assert.match(pagination(served.messages), /aria-current="page">Page 1 of 2<\/span>/);
    });
  });

  describe('themes (AC #2)', () => {
    const themes = cards(served.themes);

    it('draws each theme as a card, the active one marked and every other with Activate', () => {
      assert.deepEqual(themes.slice(0, 2).map(cardTitle), ['Default', 'Midnight']);
      const [packaged, midnight] = themes;
      assert.ok(
        badges(packaged ?? '').some(
          (badge) => badge.label === 'Active' && badge.modifiers.includes('badge-primary'),
        ),
        'the packaged theme is marked Active',
      );
      assert.doesNotMatch(packaged ?? '', />Activate</);
      assert.match(
        midnight ?? '',
        /<input type="hidden" name="theme" value="midnight" \/>[\s\S]*<button type="submit" class="btn btn-primary[^"]*">Activate<\/button>/,
      );
      assert.ok(!badges(midnight ?? '').some((badge) => badge.label === 'Active'));
    });

    it('lists what is not a theme in a card of its own', () => {
      const broken = themes.find((card) => cardTitle(card) === 'Not themes');
      assert.match(broken ?? '', /<code>broken<\/code>/);
    });
  });

  describe('navigation (AC #2)', () => {
    const menus = cards(served.navigation);
    const titled = (title: string): string => menus.find((card) => cardTitle(card) === title) ?? '';

    it('draws one card per menu, each saving its own items', () => {
      assert.deepEqual(menus.map(cardTitle), [
        'Site menu',
        'Footer links',
        'top_bar',
        'Add a menu',
      ]);
      for (const name of ['primary', 'footer', 'top_bar']) {
        const menu = menus.find((card) => card.includes(`<code>menus.${name}</code>`)) ?? '';
        assert.match(menu, /<form method="post" action="\/admin\/navigation">/);
        assert.match(menu, new RegExp(`<input type="hidden" name="menu" value="${name}" />`));
        assert.match(menu, /<button type="submit" class="btn[^"]*">Save menu<\/button>/);
      }
    });

    it('offers Delete on a kept menu alone, and Add in a card of its own', () => {
      assert.match(
        titled('top_bar'),
        /<form method="post" action="\/admin\/navigation\/delete">[\s\S]*<button type="submit" class="btn[^"]*btn-error[^"]*">Delete this menu<\/button>/,
      );
      assert.doesNotMatch(titled('Site menu'), /navigation\/delete/);
      assert.match(
        titled('Add a menu'),
        /<form method="post" action="\/admin\/navigation\/add">[\s\S]*name="name"[\s\S]*>Add menu<\/button>/,
      );
    });
  });

  describe('the settings panels, tools, IndieAuth and error screens (AC #3)', () => {
    const titles = (screen: RemainingScreen): string[] => cards(served[screen]).map(cardTitle);

    it('draws each settings panel as a card', () => {
      assert.deepEqual(titles('settingsPermalinks'), ['Archive redirects']);
      assert.deepEqual(titles('settingsDiscussion'), ['Spam checking']);
      assert.deepEqual(titles('settingsEmail'), ['Mail credentials']);
      assert.deepEqual(titles('federationSettings'), ['WordPress paths']);
    });

    it('states the Akismet key and the mail credential with a badge word', () => {
      assert.deepEqual(badges(cards(served.settingsDiscussion)[0] ?? ''), [
        { label: 'Not recognised', modifiers: 'badge-sm badge-error' },
      ]);
      assert.deepEqual(badges(cards(served.settingsEmail)[0] ?? '').slice(0, 1), [
        { label: 'Configured', modifiers: 'badge-sm badge-success' },
      ]);
      assert.match(
        cards(served.settingsEmail)[0] ?? '',
        /<form method="post" action="\/admin\/settings\/mail\/test">[\s\S]*>Send test email<\/button>/,
      );
    });

    it('draws Tools and Personal data in cards', () => {
      assert.deepEqual(titles('tools'), ['What the index holds']);
      assert.deepEqual(titles('toolsConfirm'), ['What the index holds', 'Rebuild the index now?']);
      assert.deepEqual(titles('personalData'), ['Look up an address']);
      assert.deepEqual(titles('personalDataFound'), ['What this site holds for ada@example.com']);
    });

    for (const screen of ['consent', 'refused', 'error'] as const) {
      it(`draws ${screen} as one card in the centred column, headed by the page's heading`, () => {
        const page = screenOf(served[screen]);
        assert.match(page, /<main id="main" class="mx-auto flex min-h-screen max-w-md/);
        assert.equal(cards(served[screen]).length, 1);
        assert.match(cards(served[screen])[0] ?? '', /<h1 class="card-title/);
      });
    }

    it('offers Approve and Deny on the consent card', () => {
      const card = cards(served.consent)[0] ?? '';
      assert.match(
        card,
        /<button type="submit" class="btn btn-primary[^"]*" name="decision" value="approve">Approve<\/button>/,
      );
      assert.match(
        card,
        /<button type="submit" class="btn[^"]*" name="decision" value="deny">Deny<\/button>/,
      );
    });

    it('draws the placeholder as a card under its heading', () => {
      const environment = createAdminTemplateEnvironment({ noCache: true });
      const html = environment.render(ADMIN_TEMPLATES.placeholder, {
        heading: 'Widgets',
        slug: 'blue',
        navigation: [],
      });
      assert.match(html, /<h1 class="mb-6 text-2xl font-bold">Widgets: blue<\/h1>/);
      assert.equal(cards(html).length, 1);
      assert.match(text(cards(html)[0] ?? ''), /This screen is not built yet\./);
      assert.deepEqual(
        classesOutsideTheBar(html).filter((token) => token.startsWith('admin-')),
        [],
      );
    });
  });

  describe('the user forms', () => {
    it('draws each of a user’s forms as a card', () => {
      assert.deepEqual(cards(served.usersEdit).map(cardTitle), [
        'Account',
        'Profile',
        'Email ada about',
        'Connected apps',
        'Theme',
        'Change your password',
        'Delete',
      ]);
      assert.deepEqual(cards(served.usersEditOther).map(cardTitle), [
        'Account',
        'Profile',
        'Email grace about',
        'Delete',
      ]);
      assert.equal(cards(served.usersNew).length, 1);
    });
  });
});
