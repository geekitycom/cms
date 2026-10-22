import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';

import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin, PluginWidget } from '../plugin.ts';
import type { Cms } from '../index.ts';
import { createUser } from '../site/users.ts';
import { csrfField, sandbox, signedIn, signIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { screenOf, text } from './__testing__/markup.ts';

const box = sandbox();
after(() => box.cleanup());

beforeEach(() => {
  mock.method(console, 'warn', () => {});
});
afterEach(() => mock.restoreAll());

const PLUGIN = '@test/plugin-cards';
const LAYOUT_PATH = '/admin/dashboard/layout';

const loads = new Map<string, number>();

function card(id: string, title: string): PluginWidget {
  return {
    id,
    title,
    width: 'half',
    refreshSeconds: 0,
    load: () => {
      loads.set(id, (loads.get(id) ?? 0) + 1);
      return [{ paragraph: [`${title} body.`] }];
    },
  };
}

function cardsPlugin(widgets: readonly PluginWidget[], name = PLUGIN): Plugin {
  return definePlugin({
    name,
    version: '1.0.0',
    label: name,
    description: 'Adds cards.',
    hostApi: HOST_API_VERSION,
    register(host) {
      for (const widget of widgets) host.widget(widget);
    },
  });
}

const ALPHA = card('alpha', 'Alpha');
const BETA = card('beta', 'Beta');
const GAMMA = card('gamma', 'Gamma');

function siteJson(enabled: readonly string[]): string {
  return JSON.stringify({
    title: 'A Site',
    plugins: Object.fromEntries(enabled.map((name) => [name, { enabled: true }])),
  });
}

interface Site {
  cms: Cms;
  agent: Browser;
  siteFile: string;
}

async function site(
  plugins: Plugin[] = [cardsPlugin([ALPHA, BETA, GAMMA])],
  { keepCore = false } = {},
): Promise<Site> {
  loads.clear();
  const contentDir = await box.dir('geekity-arrange-content-');
  const dataDir = await box.dir('geekity-arrange-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  const siteFile = path.join(contentDir, '_data', 'site.json');
  await writeFile(siteFile, siteJson(plugins.map((plugin) => plugin.name)), 'utf8');
  const cms = await box.open({ contentDir, dataDir, plugins });
  const agent = await signedIn(cms);
  if (!keepCore) await removeCoreCards(agent);
  return { cms, agent, siteFile };
}

async function removeCoreCards(agent: Browser): Promise<void> {
  const { html } = await dashboard(agent);
  for (const [, core] of html.matchAll(/data-dashboard-card="(core:[^"]+)"/g)) {
    await arrange(agent, { action: 'remove', widget: core ?? '' });
  }
}

async function dashboard(agent: Browser): Promise<{ html: string; words: string }> {
  const response = await agent.get('/admin');
  assert.equal(response.status, 200);
  const html = await response.text();
  return { html, words: text(screenOf(html)) };
}

async function arrange(
  agent: Browser,
  fields: Record<string, string> | [string, string][],
): Promise<Response> {
  const token = csrfField((await dashboard(agent)).html);
  assert.ok(token !== undefined);
  const pairs = Array.isArray(fields) ? fields : Object.entries(fields);
  return agent.post(LAYOUT_PATH, [['csrf_token', token], ...pairs]);
}

async function press(agent: Browser, id: string, action: string): Promise<Response> {
  const { html } = await dashboard(agent);
  const form = [
    ...html.matchAll(/<form method="post" action="\/admin\/dashboard\/layout"[\s\S]*?<\/form>/g),
  ]
    .map(([found]) => found)
    .find((found) => found.includes(`name="widget" value="${key(id)}"`));
  assert.ok(form, `the ${id} card has a form`);
  const fields = [...form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(
    ([, name, value]): [string, string] => [name ?? '', value ?? ''],
  );
  return agent.post(LAYOUT_PATH, [...fields, ['action', action]]);
}

function key(id: string): string {
  return `${PLUGIN}:${id}`;
}

function columnsOf(html: string): [string[], string[]] {
  const split = html.indexOf('data-dashboard-column="right"');
  assert.ok(html.includes('data-dashboard-column="left"'), 'the left column is drawn');
  assert.ok(split >= 0, 'the right column is drawn');
  const ids = (part: string) =>
    [...part.matchAll(/data-dashboard-card="([^"]+)"/g)]
      .map(([, found]) => found ?? '')
      .filter((found) => !found.startsWith('core:'))
      .map((found) => found.replace(/^.*:/, ''));
  return [ids(html.slice(0, split)), ids(html.slice(split))];
}

async function columns(agent: Browser): Promise<[string[], string[]]> {
  return columnsOf((await dashboard(agent)).html);
}

const DELTA = card('delta', 'Delta');

describe('arranging the dashboard (TASK-469, TASK-479)', () => {
  it('fills two columns in the default order, alternating left and right (AC #1, #2)', async () => {
    const { agent } = await site([cardsPlugin([ALPHA, BETA, GAMMA, DELTA])]);
    assert.deepEqual(await columns(agent), [
      ['alpha', 'gamma'],
      ['beta', 'delta'],
    ]);
  });

  it('puts a full width widget in a column like any other (AC #1)', async () => {
    const wide: PluginWidget = { ...card('wide', 'Wide'), width: 'full' };
    const { agent } = await site([cardsPlugin([ALPHA, wide, BETA])]);
    const { html } = await dashboard(agent);
    assert.deepEqual(columnsOf(html), [['alpha', 'beta'], ['wide']]);
    assert.doesNotMatch(html, /col-span/);
  });

  it('moves a card down and up its column, and the order survives a reload (AC #3)', async () => {
    const { agent } = await site([cardsPlugin([ALPHA, BETA, GAMMA, DELTA])]);

    const response = await press(agent, 'alpha', 'later');
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin');
    assert.deepEqual(await columns(agent), [
      ['gamma', 'alpha'],
      ['beta', 'delta'],
    ]);

    await press(agent, 'delta', 'earlier');
    assert.deepEqual(await columns(agent), [
      ['gamma', 'alpha'],
      ['delta', 'beta'],
    ]);
  });

  it('moves a card to the other column and back (AC #3)', async () => {
    const { agent } = await site([cardsPlugin([ALPHA, BETA, GAMMA, DELTA])]);

    await press(agent, 'gamma', 'right');
    assert.deepEqual(await columns(agent), [['alpha'], ['beta', 'gamma', 'delta']]);

    await press(agent, 'beta', 'left');
    assert.deepEqual(await columns(agent), [
      ['beta', 'alpha'],
      ['gamma', 'delta'],
    ]);
  });

  it('moves a card into an empty column (AC #3)', async () => {
    const { agent } = await site([cardsPlugin([ALPHA, BETA])]);
    await press(agent, 'beta', 'left');
    assert.deepEqual(await columns(agent), [['beta', 'alpha'], []]);

    await press(agent, 'alpha', 'right');
    assert.deepEqual(await columns(agent), [['beta'], ['alpha']]);
  });

  it('moves past a card that drew nothing, as the page shows it (AC #3)', async () => {
    const empty: PluginWidget = { ...card('empty', 'Empty'), load: () => [] };
    const { agent } = await site([cardsPlugin([ALPHA, BETA, empty, GAMMA, DELTA])]);
    assert.deepEqual(await columns(agent), [
      ['alpha', 'delta'],
      ['beta', 'gamma'],
    ]);

    await arrange(agent, [
      ['action', 'later'],
      ['widget', key('alpha')],
      ['shown', key('alpha')],
      ['shown', key('beta')],
      ['shown', key('gamma')],
      ['shown', key('delta')],
    ]);

    assert.deepEqual(await columns(agent), [
      ['delta', 'alpha'],
      ['beta', 'gamma'],
    ]);
  });

  it('takes both columns from drag and drop, an empty one included (AC #3)', async () => {
    const { agent } = await site();

    await arrange(agent, [
      ['action', 'order'],
      ['right', key('gamma')],
      ['right', key('alpha')],
      ['right', key('beta')],
    ]);

    assert.deepEqual(await columns(agent), [[], ['gamma', 'alpha', 'beta']]);
  });

  it('keeps the period when it redirects back', async () => {
    const { agent } = await site();
    const response = await arrange(agent, { action: 'later', widget: key('alpha'), period: '30' });
    assert.equal(response.headers.get('location'), '/admin?period=30');
  });

  it('collapses a card to its title, does not load it, and expands it again (AC #6)', async () => {
    const { agent } = await site();
    await arrange(agent, { action: 'collapse', widget: key('beta') });
    loads.clear();

    const { words } = await dashboard(agent);
    assert.match(words, /Beta/);
    assert.doesNotMatch(words, /Beta body\./);
    assert.equal(loads.get('beta'), undefined);
    assert.equal(loads.get('alpha'), 1);

    await arrange(agent, { action: 'expand', widget: key('beta') });
    assert.match((await dashboard(agent)).words, /Beta body\./);
  });

  it('removes a card, does not load it, and the gear adds it back (AC #6)', async () => {
    const { agent } = await site(undefined, { keepCore: true });
    assert.match((await dashboard(agent)).words, /No cards are removed\./);

    await arrange(agent, { action: 'remove', widget: key('gamma') });
    loads.clear();
    const { html, words } = await dashboard(agent);
    assert.doesNotMatch(words, /Gamma body\./);
    assert.equal(loads.get('gamma'), undefined);
    assert.doesNotMatch(words, /No cards are removed\./);
    const gear = /<div[^>]*popover id="dashboard-cards">([\s\S]*?)<\/div>\s*<\/div>/.exec(html);
    assert.ok(gear, 'the gear lists the removed cards');
    assert.match(text(gear[1] ?? ''), /Gamma Add back/);

    await arrange(agent, { action: 'restore', widget: key('gamma') });
    const back = await dashboard(agent);
    assert.match(back.words, /Gamma body\./);
    assert.match(back.words, /No cards are removed\./);
  });

  it('adds a removed card back to the column it was in (AC #6)', async () => {
    const { agent } = await site([cardsPlugin([ALPHA, BETA, GAMMA, DELTA])]);
    await arrange(agent, { action: 'remove', widget: key('alpha') });
    await arrange(agent, { action: 'remove', widget: key('gamma') });
    assert.deepEqual(await columns(agent), [[], ['beta', 'delta']]);

    await arrange(agent, { action: 'restore', widget: key('gamma') });
    assert.deepEqual(await columns(agent), [['gamma'], ['beta', 'delta']]);
  });

  it('keeps each user’s arrangement apart, and a new user sees the default order', async () => {
    const { cms, agent } = await site();
    await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'another long password',
    });
    const grace = await signIn(cms, { username: 'grace', password: 'another long password' });

    await arrange(agent, { action: 'remove', widget: key('alpha') });
    await press(agent, 'gamma', 'right');

    assert.deepEqual(await columns(agent), [[], ['gamma', 'beta']]);
    assert.deepEqual(await columns(grace), [['alpha', 'gamma'], ['beta']]);
  });

  it('puts a widget the arrangement does not mention in the shorter column, and ignores one that is gone (AC #4)', async () => {
    const later = cardsPlugin([DELTA], '@test/plugin-later');
    const { agent, siteFile } = await site([cardsPlugin([ALPHA, BETA, GAMMA]), later]);
    await writeFile(siteFile, siteJson([PLUGIN]), 'utf8');

    await press(agent, 'beta', 'left');
    await writeFile(siteFile, siteJson([PLUGIN, later.name]), 'utf8');
    assert.deepEqual(await columns(agent), [['beta', 'alpha', 'gamma'], ['delta']]);

    await arrange(agent, { action: 'collapse', widget: '@test/plugin-later:delta' });
    await writeFile(siteFile, siteJson([later.name]), 'utf8');
    const { html, words } = await dashboard(agent);
    assert.doesNotMatch(words, /Alpha|Beta|Gamma/);
    assert.deepEqual(columnsOf(html), [[], ['delta']]);
  });

  it('reads an arrangement saved as one order as columns alternating in that order (AC #5)', async () => {
    const { cms, agent } = await site([cardsPlugin([ALPHA, BETA, GAMMA, DELTA])]);
    const usersFile = path.join(cms.config.dataDir, 'users.json');
    const stored = JSON.parse(await readFile(usersFile, 'utf8')) as {
      users: Record<string, unknown>[];
    };
    stored.users = stored.users.map((user) => ({
      ...user,
      dashboardLayout: {
        order: [key('delta'), key('gamma'), key('beta'), key('alpha')],
        collapsed: [],
        removed: [],
      },
    }));
    await writeFile(usersFile, JSON.stringify(stored), 'utf8');

    assert.deepEqual(await columns(agent), [
      ['delta', 'beta'],
      ['gamma', 'alpha'],
    ]);

    await arrange(agent, { action: 'collapse', widget: key('alpha') });
    const saved = JSON.parse(await readFile(usersFile, 'utf8')) as {
      users: { dashboardLayout?: Record<string, unknown> }[];
    };
    const savedColumns = saved.users[0]?.dashboardLayout?.['columns'] as string[][];
    assert.deepEqual(
      savedColumns.map((column) => column.filter((saved) => !saved.startsWith('core:'))),
      [
        [key('delta'), key('beta')],
        [key('gamma'), key('alpha')],
      ],
    );
    assert.equal(saved.users[0]?.dashboardLayout?.['order'], undefined);
  });

  it('refuses a change without the CSRF token', async () => {
    const { agent } = await site();
    const response = await agent.post(LAYOUT_PATH, { action: 'remove', widget: key('alpha') });
    assert.equal(response.status, 403);
    assert.match((await dashboard(agent)).words, /Alpha body\./);
  });

  it('draws every control as a form that posts without JavaScript (AC #3)', async () => {
    const { agent } = await site();
    const { html } = await dashboard(agent);
    const forms = [
      ...html.matchAll(/<form method="post" action="\/admin\/dashboard\/layout"[\s\S]*?<\/form>/g),
    ].map(([form]) => form);
    const formOf = (id: string) => {
      const found = forms.find((form) => form.includes(`name="widget" value="${key(id)}"`));
      assert.ok(found, `the ${id} card has a form`);
      return found;
    };
    const alpha = formOf('alpha');
    assert.match(alpha, new RegExp(`name="shown" value="${key('beta')}"`));
    for (const action of ['later', 'right', 'collapse', 'remove']) {
      assert.match(alpha, new RegExp(`<button type="submit"[^>]*name="action" value="${action}"`));
    }
    assert.match(alpha, /aria-label="Move Alpha to the right column"/);
    assert.match(alpha, /value="left"[^>]*hidden/);
    assert.match(alpha, /name="csrf_token"/);
    assert.match(formOf('beta'), /aria-label="Move Beta to the left column"/);
    assert.match(formOf('beta'), /value="right"[^>]*hidden/);
  });
});
