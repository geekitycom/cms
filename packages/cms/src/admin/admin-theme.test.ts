import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

import themeOrder from 'daisyui/functions/themeOrder';

import { findUser, findUserById, setUserAdminTheme, usersFile } from './accounts.ts';
import { ADMIN_THEMES, adminColorScheme, adminTheme } from './admin-theme.ts';
import { ADMIN_SECTIONS } from './menu.ts';
import { DAISYUI_ADMIN_DIR } from './templates.ts';
import { csrfField, FIRST_ADMIN, sandbox, signedIn } from './__testing__/harness.ts';

/**
 * Each user draws the admin in a built-in DaisyUI theme of their own choosing,
 * or follows the system (decision-30, TASK-267).
 */

const execFile = promisify(execFileCallback);

const box = sandbox();
after(() => box.cleanup());

const COMPILED = path.join(DAISYUI_ADMIN_DIR, 'static', 'admin.css');

/** The `data-theme` on a page's `<html>`, or `undefined` when it carries none. */
function dataTheme(html: string): string | undefined {
  const root = /<html\b[^>]*>/.exec(html)?.[0] ?? '';
  return /\bdata-theme="([^"]*)"/.exec(root)?.[1];
}

/** The `color-scheme` the compiled sheet gives `[data-theme="<name>"]`. */
function compiledScheme(css: string, name: string): string | undefined {
  return new RegExp(`\\[data-theme="${name}"\\]\\s*\\{\\s*color-scheme:\\s*(\\w+);`).exec(css)?.[1];
}

describe('the table of admin themes', () => {
  it("names every built-in DaisyUI theme, in DaisyUI's order", () => {
    assert.deepEqual(Object.keys(ADMIN_THEMES), themeOrder);
  });

  it('says light or dark for each exactly as the compiled stylesheet does', async () => {
    const css = await readFile(COMPILED, 'utf8');
    const disagreeing = Object.entries(ADMIN_THEMES)
      .filter(([name, { scheme }]) => compiledScheme(css, name) !== scheme)
      .map(([name]) => name);
    assert.deepEqual(disagreeing, []);
  });
});

describe('adminColorScheme', () => {
  it('reduces a light theme to light, a dark one to dark, and following the system to auto', () => {
    assert.equal(adminColorScheme('cupcake'), 'light');
    assert.equal(adminColorScheme('light'), 'light');
    assert.equal(adminColorScheme('dracula'), 'dark');
    assert.equal(adminColorScheme('dark'), 'dark');
    assert.equal(adminColorScheme(undefined), 'auto');
  });
});

describe('adminTheme', () => {
  it('reads a built-in theme by its DaisyUI name', () => {
    assert.equal(adminTheme('dracula'), 'dracula');
    assert.equal(adminTheme('caramellatte'), 'caramellatte');
  });

  it('reads anything else as no theme', () => {
    for (const value of ['', 'Dracula', 'solarized', 'constructor', 'toString', 42, null, {}]) {
      assert.equal(adminTheme(value), undefined, JSON.stringify(value));
    }
  });
});

describe('a theme on the users file', () => {
  it('is written beside the notification maps, and following the system writes nothing', async () => {
    const cms = await box.site();
    await signedIn(cms);
    const { dataDir } = cms.config;
    const id = findUser(dataDir, FIRST_ADMIN.username)?.id ?? 0;

    await setUserAdminTheme({ dataDir, userId: id, theme: 'dracula' });
    assert.equal(findUserById(dataDir, id)?.adminTheme, 'dracula');

    await setUserAdminTheme({ dataDir, userId: id, theme: undefined });
    assert.equal(findUserById(dataDir, id)?.adminTheme, undefined);
    assert.doesNotMatch(await readFile(usersFile(dataDir), 'utf8'), /adminTheme/);
  });

  it('drops a theme this version does not know, so the user follows the system', async () => {
    const cms = await box.site();
    await signedIn(cms);
    const { dataDir } = cms.config;
    const file = JSON.parse(await readFile(usersFile(dataDir), 'utf8')) as {
      users: Record<string, unknown>[];
    };
    for (const user of file.users) user['adminTheme'] = 'solarized';
    await writeFile(usersFile(dataDir), JSON.stringify(file));

    assert.equal(findUser(dataDir, FIRST_ADMIN.username)?.adminTheme, undefined);
  });
});

describe('the old admin, with GEEKITY_ADMIN unset', () => {
  it('offers no theme and draws no data-theme, whatever the user chose', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { dataDir } = cms.config;
    const id = findUser(dataDir, FIRST_ADMIN.username)?.id ?? 0;
    await setUserAdminTheme({ dataDir, userId: id, theme: 'dracula' });

    const edit = await (await agent.get(`/admin/users/${String(id)}`)).text();
    assert.doesNotMatch(edit, /admin_theme/);
    assert.equal(dataTheme(edit), undefined);
    assert.equal(dataTheme(await (await agent.get('/admin')).text()), undefined);
  });

  it('still takes the form, but only for whoever is signed in', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { dataDir } = cms.config;
    const id = findUser(dataDir, FIRST_ADMIN.username)?.id ?? 0;
    const token = csrfField(await (await agent.get('/admin/users')).text()) ?? '';

    const response = await agent.post('/admin/users/theme', {
      csrf_token: token,
      admin_theme: 'nord',
      user_id: '999',
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/admin/users/${String(id)}`);
    assert.equal(findUserById(dataDir, id)?.adminTheme, 'nord');
  });
});

describe('with GEEKITY_ADMIN=daisyui, over HTTP', async () => {
  const { stdout } = await execFile(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx'),
      path.join(import.meta.dirname, '__testing__', 'theme-probe.ts'),
    ],
    { env: { ...process.env, GEEKITY_ADMIN: 'daisyui' }, maxBuffer: 64 * 1024 * 1024 },
  );
  const served = JSON.parse(stdout) as {
    setup: string;
    edit: string;
    editUrl: string;
    someoneElse: string;
    storedBefore: unknown;
    choseDracula: number;
    storedDracula: unknown;
    screens: Record<string, string>;
    account: Record<string, string>;
    stylesheet: string;
    choseUnknown: number;
    storedAfterUnknown: unknown;
    choseSystem: number;
    storedSystem: unknown;
    dashboardSystem: string;
  };

  const select = /<select\b[^>]*\bname="admin_theme"[^>]*>([\s\S]*?)<\/select>/.exec(served.edit);
  const options = [...(select?.[1] ?? '').matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)</g)].map(
    ([, value, attributes, label]) => ({
      value: value ?? '',
      selected: (attributes ?? '').includes('selected'),
      label: (label ?? '').trim(),
    }),
  );

  it("puts a select on the user's own screen: Follow the system, then every built-in theme", () => {
    assert.ok(select !== null, 'the edit screen has the admin_theme select');
    assert.deepEqual(options[0], { value: '', selected: true, label: 'Follow the system' });
    assert.deepEqual(
      options.slice(1).map(({ value }) => value),
      themeOrder,
    );
    assert.equal(options.find(({ value }) => value === 'cmyk')?.label, 'CMYK');
  });

  it("offers no theme on somebody else's screen", () => {
    assert.match(served.someoneElse, /Edit grace/);
    assert.doesNotMatch(served.someoneElse, /admin_theme/);
  });

  it('offers only themes the table holds', () => {
    const outside = options
      .slice(1)
      .filter(({ value }) => adminTheme(value) === undefined)
      .map(({ value }) => value);
    assert.deepEqual(outside, []);
  });

  it('stores nothing for a user who has not chosen', () => {
    assert.equal(served.storedBefore, null);
  });

  it('stores a chosen theme in data/users.json and holds it in the select', () => {
    assert.equal(served.choseDracula, 303);
    assert.equal(served.storedDracula, 'dracula');
    assert.match(served.screens[served.editUrl] ?? '', /<option value="dracula" selected>/);
  });

  it('refuses a theme outside the table and keeps the one stored', () => {
    assert.equal(served.choseUnknown, 303);
    assert.equal(served.storedAfterUnknown, 'dracula');
  });

  it('carries the chosen theme as data-theme on every screen in the menu', () => {
    const urls = ADMIN_SECTIONS.flatMap((section) => section.children.map((child) => child.url));
    const missing = [...urls, served.editUrl].filter(
      (url) => dataTheme(served.screens[url] ?? '') !== 'dracula',
    );
    assert.deepEqual(missing, []);
  });

  it('carries none on the login, setup, forgot and reset screens, even for a signed-in user', () => {
    assert.equal(dataTheme(served.setup), undefined);
    for (const [screen, html] of Object.entries(served.account)) {
      assert.match(html, /<html\b/, `${screen} rendered`);
      assert.equal(dataTheme(html), undefined, screen);
    }
  });

  it('draws the dashboard in the dark palette of the chosen theme', () => {
    const dashboard = served.screens['/admin'] ?? '';
    assert.equal(dataTheme(dashboard), 'dracula');
    assert.equal(adminColorScheme('dracula'), 'dark');
    assert.equal(compiledScheme(served.stylesheet, 'dracula'), 'dark');
    assert.match(
      served.stylesheet,
      /\[data-theme="dracula"\]\s*\{\s*color-scheme: dark;[^}]*--color-base-100:/,
    );
  });

  it('takes Follow the system as removing the choice, and the dashboard then names no theme', () => {
    assert.equal(served.choseSystem, 303);
    assert.equal(served.storedSystem, null);
    assert.equal(dataTheme(served.dashboardSystem), undefined);
  });
});
