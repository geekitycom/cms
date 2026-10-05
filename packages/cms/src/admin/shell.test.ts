import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { browser, csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import { saveSettings, SETTINGS_PAGE_FORMS, settingsPageUrl } from './__testing__/settings.ts';
import { adminMenu } from './menu.ts';
import { RESET_PATH } from './recovery.ts';
import { MAIL_TEST_FIELDS, MAIL_TEST_PATH } from './settings-email.ts';
import type { FlashMessage } from './store.ts';
import { createAdminTemplateEnvironment } from './templates.ts';

/**
 * The admin's chrome (decision-30, TASK-270): the shell every signed-in screen
 * is drawn inside, the settings pages' layout, the flash and the four account
 * screens.
 */

const environment = createAdminTemplateEnvironment({ noCache: true });

const CHROME = {
  site: { title: 'A Site' },
  adminUrl: '/admin',
  siteUrl: '/',
  newPostUrl: '/admin/posts/new',
  assetPrefix: '/admin/_static/',
  cspNonce: 'nonce',
  barScheme: 'auto',
  csrfToken: 'token',
  navigation: adminMenu({ section: 'posts', child: 'tags' }),
  flash: [] as FlashMessage[],
};

/** A screen that extends the shell and says nothing of its own but a heading. */
function shell(context: Record<string, unknown> = {}): string {
  return environment.renderString(
    '{% extends "layouts/shell.njk" %}{% block content %}<h1>Tags</h1>{% endblock %}',
    { ...CHROME, ...context },
  );
}

/** The page with the bar's shadow root cut out, which keeps classes of its own. */
function outsideTheBar(html: string): string {
  return html.replace(/<geekity-admin-bar\b[\s\S]*<\/geekity-admin-bar>/, '');
}

/** Every class token the markup carries. */
function classTokens(html: string): string[] {
  return [...html.matchAll(/\bclass="([^"]*)"/g)].flatMap(([, value]) =>
    (value ?? '').split(/\s+/).filter(Boolean),
  );
}

/** The section menu's landmark and what is in it. */
function sectionsNav(html: string): string {
  const found = /<nav\b[^>]*\baria-label="Sections"[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0];
  assert.ok(found !== undefined, 'the shell has a Sections landmark');
  return found;
}

/** The text of every link, in document order. */
function linkTexts(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map(([, text]) => text ?? '');
}

describe('the shell', () => {
  it('draws the registry as a menu: every section, the open one with its children nested', () => {
    const nav = sectionsNav(shell());
    const expected = CHROME.navigation.flatMap((section) => [
      section.label,
      ...(section.open ? section.children.map((child) => child.label) : []),
    ]);

    assert.match(nav, /<ul class="menu\b/);
    assert.deepEqual(linkTexts(nav), expected, 'closed sections list no children');
    assert.match(
      nav,
      /<a\b[^>]*href="\/admin\/posts">Posts<\/a>\s*<ul>/,
      'the open section is a nested list inside its own item',
    );
  });

  it('marks the screen being looked at, and nothing else, with aria-current', () => {
    const html = shell();
    const current = [...html.matchAll(/<a\b[^>]*\baria-current="page"[^>]*>[^<]*<\/a>/g)].map(
      ([tag]) => tag,
    );
    assert.equal(current.length, 1, current.join('\n'));
    assert.match(current[0] ?? '', /href="\/admin\/tags"[^>]*>Tags<\/a>$/);
  });

  it('puts the menu ahead of the screen, so a keyboard meets it first as in the old shell', () => {
    const html = shell();
    assert.ok(html.indexOf('aria-label="Sections"') < html.indexOf('<main id="main"'));
    assert.equal(html.match(/<main\b/g)?.length, 1);
  });

  it('opens the menu from a drawer on a narrow screen, toggled by a checkbox and no script', () => {
    const html = shell();
    const toggle = /<input id="([\w-]+)" type="checkbox" class="drawer-toggle"[^>]*>/.exec(html);
    assert.ok(toggle, 'the drawer has its checkbox');
    const id = toggle[1] ?? '';

    assert.match(html, /<div class="drawer lg:drawer-open">/, 'always open from lg up');
    assert.match(
      html,
      new RegExp(
        `<label for="${id}" class="[^"]*\\bdrawer-button\\b[^"]*\\blg:hidden\\b[^"]*">Menu</label>`,
      ),
      'a Menu button opens it below lg',
    );
    const side = html.indexOf('class="drawer-side');
    const content = html.indexOf('class="drawer-content');
    const nav = html.indexOf('aria-label="Sections"');
    assert.ok(side >= 0 && side < nav && nav < content, 'the menu is the drawer side');
    assert.ok(content < html.indexOf('<main id="main"'), 'the screen is the drawer content');

    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag);
    assert.deepEqual(scripts, ['<script src="/admin/_static/admin-bar.js" defer>']);
  });

  it('draws each flash as an alert in the colour of its kind, as a status rather than an alarm', () => {
    const html = shell({
      flash: [
        { kind: 'notice', message: 'General settings saved <b>now</b>.' },
        { kind: 'warning', message: 'An image has no description.' },
        { kind: 'error', message: 'That comment is not here any more.' },
      ],
    });
    const alerts = [...html.matchAll(/<div role="status" class="([^"]*)">([\s\S]*?)<\/div>/g)].map(
      ([, classes, body]) => [classes, body?.replaceAll(/\s+/g, ' ').trim()],
    );

    assert.deepEqual(alerts, [
      ['alert alert-success', '<span>General settings saved &lt;b&gt;now&lt;/b&gt;.</span>'],
      ['alert alert-warning', '<span>An image has no description.</span>'],
      ['alert alert-error', '<span>That comment is not here any more.</span>'],
    ]);
    assert.doesNotMatch(html, /role="alert"/, 'a refused form summary stays the one alert');
  });

  it('carries no legacy admin-* class outside the bar', () => {
    assert.deepEqual(
      classTokens(outsideTheBar(shell())).filter((token) => token.startsWith('admin-')),
      [],
    );
  });
});

describe('the settings page layout', () => {
  const html = environment.renderString(
    `{% extends "layouts/settings-page.njk" %}
     {% import "components/fields.njk" as field %}
     {% block settingsProblems %}{{ field.problem('settings-title', 'A title is needed.') }}{% endblock %}
     {% block settingsFields %}{{ field.text('settings-title', 'title', 'Site title', '', error='A title is needed.') }}{% endblock %}
     {% block settingsPanels %}<section id="panel">Panel</section>{% endblock %}`,
    { ...CHROME, settingsLabel: 'General', settingsUrl: '/admin/settings', hasProblems: true },
  );
  const main = /<main\b[\s\S]*<\/main>/.exec(html)?.[0] ?? '';

  it('heads the page, then the summary, the form, and the panels after it', () => {
    const order = [
      main.indexOf('<h1'),
      main.indexOf('role="alert"'),
      main.indexOf('<form'),
      main.indexOf('id="panel"'),
    ];
    assert.ok(
      order.every((at) => at >= 0),
      `all four are there: ${order.join(', ')}`,
    );
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
    assert.match(main, /<h1 class="[^"]*">General<\/h1>/);
    assert.match(
      main,
      /<form class="[^"]*\bmax-w-2xl\b[^"]*" method="post" action="\/admin\/settings">/,
    );
  });

  it('saves with the primary button macro', () => {
    assert.match(
      main,
      /<button type="submit" class="btn btn-primary btn-sm">Save settings<\/button>/,
    );
  });

  it('carries no legacy admin-* class of its own', () => {
    assert.deepEqual(
      classTokens(outsideTheBar(html)).filter((token) => token.startsWith('admin-')),
      [],
    );
  });
});

/** The checks every account screen is held to: one centred card, headed by its h1. */
function assertOneCentredCard(html: string, screen: string): void {
  const main = /<main\b([^>]*)>([\s\S]*)<\/main>/.exec(html);
  assert.ok(main, `${screen} has a <main>`);
  assert.match(main[1] ?? '', /class="[^"]*\bmx-auto\b[^"]*\bmax-w-md\b/, `${screen} is centred`);
  const cards = classTokens(main[2] ?? '').filter((token) => token === 'card');
  assert.equal(cards.length, 1, `${screen} is one card`);
  const card = (main[2] ?? '').slice((main[2] ?? '').indexOf('class="card '));
  assert.match(
    card,
    /^[^]*?<h1 class="card-title\b[^"]*">[^<]+<\/h1>/,
    `${screen}'s card is headed`,
  );
  assert.deepEqual(
    classTokens(html).filter((token) => token.startsWith('admin-')),
    [],
    `${screen} carries no legacy admin-* class`,
  );
}

describe('the account screens', () => {
  const screens: Record<string, Record<string, unknown>> = {
    login: { loginUrl: '/admin/login', forgotUrl: '/admin/forgot' },
    setup: { setupUrl: '/admin/setup' },
    forgot: {
      configured: true,
      forgotUrl: '/admin/forgot',
      loginUrl: '/admin/login',
      fields: { identifier: 'identifier' },
    },
    reset: {
      resetUrl: '/admin/reset',
      forgotUrl: '/admin/forgot',
      token: 'abc',
      fields: { token: 'token', password: 'password', passwordConfirmation: 'confirmation' },
    },
  };

  for (const [name, context] of Object.entries(screens)) {
    it(`draws ${name} as one centred card with a primary submit button`, () => {
      const html = environment.render(`pages/account/${name}.njk`, {
        site: { title: 'A Site' },
        csrfToken: 'token',
        ...context,
      });
      assertOneCentredCard(html, name);
      assert.match(html, /<button type="submit" class="btn btn-primary btn-sm btn-block">/);
    });
  }

  it('draws a reset link that no longer works as an error alert in the card', () => {
    const html = environment.render('pages/account/reset.njk', {
      invalid: true,
      forgotUrl: '/admin/forgot',
    });
    assertOneCentredCard(html, 'reset, invalid');
    assert.match(html, /<div role="alert" class="alert alert-error">/);
  });
});

describe('over HTTP', async () => {
  const box = sandbox();
  after(() => box.cleanup());

  const cms = await box.site();
  const guest = browser(cms);

  async function page(url: string, as = guest): Promise<string> {
    return await (await as.get(url)).text();
  }

  const setup = await page('/admin/setup');
  const agent = await signedIn(cms);
  const account = {
    setup,
    login: await page('/admin/login'),
    forgot: await page('/admin/forgot'),
    reset: await page(`${RESET_PATH}?token=${'0'.repeat(64)}`),
  };

  const saves: Record<string, { status: number; location: string; url: string; html: string }> = {};
  for (const name of Object.keys(SETTINGS_PAGE_FORMS)) {
    const response = await saveSettings(agent, name);
    const location = response.headers.get('location') ?? '';
    saves[name] = {
      status: response.status,
      location,
      url: settingsPageUrl(name),
      html: await page(location, agent),
    };
  }

  const email = settingsPageUrl('email');
  await agent.post(MAIL_TEST_PATH, {
    csrf_token: csrfField(await page(email, agent)) ?? '',
    [MAIL_TEST_FIELDS.to]: '',
  });
  const refusedTest = await page(email, agent);

  for (const [name, html] of Object.entries(account)) {
    it(`serves the ${name} screen as one centred card`, () => {
      assertOneCentredCard(html, name);
    });
  }

  for (const [name, save] of Object.entries(saves)) {
    it(`saves the ${name} settings page and says so in a success alert in the shell`, () => {
      assert.equal(save.status, 303);
      assert.equal(save.location, save.url, 'back to the page it was saved from');
      assert.match(
        save.html,
        /<div role="status" class="alert alert-success">\s*<span>[^<]* settings saved\.[^<]*<\/span>/,
      );
      assert.match(save.html, /<div class="drawer lg:drawer-open">/);
      assert.match(save.html, /class="btn btn-primary btn-sm">Save settings<\/button>/);
    });
  }

  it('shows a refused test email as an error alert', () => {
    assert.match(
      refusedTest,
      /<div role="status" class="alert alert-error">\s*<span>Type the address to send the test message to\.<\/span>/,
    );
  });
});
