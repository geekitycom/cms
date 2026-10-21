import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
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

async function site(plugins: Plugin[] = [cardsPlugin([ALPHA, BETA, GAMMA])]): Promise<Site> {
  loads.clear();
  const contentDir = await box.dir('geekity-arrange-content-');
  const dataDir = await box.dir('geekity-arrange-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  const siteFile = path.join(contentDir, '_data', 'site.json');
  await writeFile(siteFile, siteJson(plugins.map((plugin) => plugin.name)), 'utf8');
  const cms = await box.open({ contentDir, dataDir, plugins });
  return { cms, agent: await signedIn(cms), siteFile };
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

function key(id: string): string {
  return `${PLUGIN}:${id}`;
}

function cardOrder(words: string, titles: readonly string[]): string[] {
  return titles
    .map((title) => ({ title, at: words.indexOf(`${title} body.`) }))
    .filter(({ at }) => at >= 0)
    .sort((one, other) => one.at - other.at)
    .map(({ title }) => title);
}

describe('arranging the dashboard (TASK-469)', () => {
  it('moves a card later and earlier, and the order survives a reload (AC #1)', async () => {
    const { agent } = await site();

    const response = await arrange(agent, { action: 'later', widget: key('alpha') });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin');
    assert.deepEqual(cardOrder((await dashboard(agent)).words, ['Alpha', 'Beta', 'Gamma']), [
      'Beta',
      'Alpha',
      'Gamma',
    ]);

    await arrange(agent, { action: 'earlier', widget: key('gamma') });
    assert.deepEqual(cardOrder((await dashboard(agent)).words, ['Alpha', 'Beta', 'Gamma']), [
      'Beta',
      'Gamma',
      'Alpha',
    ]);
  });

  it('moves past a card that drew nothing, as the page shows it (AC #1)', async () => {
    const empty: PluginWidget = { ...card('empty', 'Empty'), load: () => [] };
    const { agent } = await site([cardsPlugin([ALPHA, empty, BETA])]);

    await arrange(agent, [
      ['action', 'later'],
      ['widget', key('alpha')],
      ['shown', key('alpha')],
      ['shown', key('beta')],
    ]);

    assert.deepEqual(cardOrder((await dashboard(agent)).words, ['Alpha', 'Beta']), [
      'Beta',
      'Alpha',
    ]);
  });

  it('takes a whole order from drag and drop (AC #1)', async () => {
    const { agent } = await site();

    await arrange(agent, [
      ['action', 'order'],
      ['order', key('gamma')],
      ['order', key('alpha')],
      ['order', key('beta')],
    ]);

    assert.deepEqual(cardOrder((await dashboard(agent)).words, ['Alpha', 'Beta', 'Gamma']), [
      'Gamma',
      'Alpha',
      'Beta',
    ]);
  });

  it('keeps the period when it redirects back', async () => {
    const { agent } = await site();
    const response = await arrange(agent, { action: 'later', widget: key('alpha'), period: '30' });
    assert.equal(response.headers.get('location'), '/admin?period=30');
  });

  it('collapses a card to its title, does not load it, and expands it again (AC #2)', async () => {
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

  it('removes a card, does not load it, and the gear adds it back (AC #3, #4)', async () => {
    const { agent } = await site();
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

  it('keeps each user’s arrangement apart, and a new user sees the default order (AC #5)', async () => {
    const { cms, agent } = await site();
    await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'another long password',
    });
    const grace = await signIn(cms, { username: 'grace', password: 'another long password' });

    await arrange(agent, { action: 'remove', widget: key('alpha') });
    await arrange(agent, { action: 'later', widget: key('beta') });

    assert.deepEqual(cardOrder((await dashboard(agent)).words, ['Alpha', 'Beta', 'Gamma']), [
      'Gamma',
      'Beta',
    ]);
    assert.deepEqual(cardOrder((await dashboard(grace)).words, ['Alpha', 'Beta', 'Gamma']), [
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });

  it('draws a widget the arrangement does not mention, and ignores one that is gone (AC #6)', async () => {
    const later = cardsPlugin([card('delta', 'Delta')], '@test/plugin-later');
    const { agent, siteFile } = await site([cardsPlugin([ALPHA, BETA, GAMMA]), later]);
    await writeFile(siteFile, siteJson([PLUGIN]), 'utf8');

    await arrange(agent, { action: 'later', widget: key('alpha') });
    await writeFile(siteFile, siteJson([PLUGIN, later.name]), 'utf8');
    assert.deepEqual(
      cardOrder((await dashboard(agent)).words, ['Alpha', 'Beta', 'Gamma', 'Delta']),
      ['Beta', 'Alpha', 'Gamma', 'Delta'],
    );

    await arrange(agent, { action: 'collapse', widget: '@test/plugin-later:delta' });
    await writeFile(siteFile, siteJson([later.name]), 'utf8');
    const { words } = await dashboard(agent);
    assert.doesNotMatch(words, /Alpha|Beta|Gamma/);
    assert.match(words, /Delta/);
  });

  it('refuses a change without the CSRF token (AC #8)', async () => {
    const { agent } = await site();
    const response = await agent.post(LAYOUT_PATH, { action: 'remove', widget: key('alpha') });
    assert.equal(response.status, 403);
    assert.match((await dashboard(agent)).words, /Alpha body\./);
  });

  it('draws every control as a form that posts without JavaScript (AC #7)', async () => {
    const { agent } = await site();
    const { html } = await dashboard(agent);
    const forms = [
      ...html.matchAll(/<form method="post" action="\/admin\/dashboard\/layout"[\s\S]*?<\/form>/g),
    ].map(([form]) => form);
    const alpha = forms.find((form) => form.includes(`value="${key('alpha')}"`));
    assert.ok(alpha, 'the Alpha card has a form');
    assert.match(alpha, new RegExp(`name="shown" value="${key('beta')}"`));
    for (const action of ['later', 'collapse', 'remove']) {
      assert.match(alpha, new RegExp(`<button type="submit"[^>]*name="action" value="${action}"`));
    }
    assert.match(alpha, /name="csrf_token"/);
  });
});
