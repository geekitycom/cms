/**
 * The dashboard's Writing goal card (TASK-501): the signed-in user's own
 * progress, pace and streak, drawn only while they track writing goals.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';

import { TEN_AM_20_OCTOBER_IN_CHICAGO } from './__testing__/chicago-clock.ts';
import { csrfField, FIRST_ADMIN, sandbox, signedIn, signIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { screenOf, text } from './__testing__/markup.ts';
import type { Cms } from '../index.ts';
import { createUser, findUser, setUserWritingGoals } from '../site/users.ts';
import type { WritingGoals } from '../site/writing-goals.ts';

const box = sandbox();
after(() => box.cleanup());

let warnings: string[];
beforeEach(() => {
  warnings = [];
  mock.method(console, 'warn', (message: string) => warnings.push(message));
});
afterEach(() => mock.restoreAll());

const TITLE = 'Writing goal';
const KEY = 'core:writing-goal';
const BOB = { username: 'bob', password: 'another horse battery' };

const MONTHLY: WritingGoals = {
  tracking: true,
  words: 31_000,
  period: 'month',
  streak: { dailyWords: 1000, missesAllowed: 1 },
};

/**
 * Today is Tuesday 20 October 2026 in Chicago. October so far holds 21,000
 * words against an even pace of 20,000. The current run is 15, 16, 18 and 19
 * October (the 17th is one allowed miss), and the best run is 1 to 6 September.
 */
const ADA_DAYS: Record<string, number> = {
  '2026-09-01': 1000,
  '2026-09-02': 1000,
  '2026-09-03': 1000,
  '2026-09-04': 1000,
  '2026-09-05': 1000,
  '2026-09-06': 1000,
  '2026-10-01': 16_700,
  '2026-10-15': 1000,
  '2026-10-16': 1000,
  '2026-10-18': 1000,
  '2026-10-19': 1000,
  '2026-10-20': 300,
};

async function site(): Promise<{ cms: Cms; agent: Browser }> {
  const contentDir = await box.dir('geekity-writing-card-content-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', timezone: 'America/Chicago' }),
    'utf8',
  );
  const dataDir = await box.dir('geekity-writing-card-data-');
  const cms = await box.site({ contentDir, dataDir, now: () => TEN_AM_20_OCTOBER_IN_CHICAGO });
  return { cms, agent: await signedIn(cms) };
}

function userId(cms: Cms, username: string): number {
  const user = findUser(cms.config.dataDir, username);
  assert.ok(user, `${username} exists`);
  return user.id;
}

async function track(cms: Cms, username: string, goals: WritingGoals = MONTHLY): Promise<void> {
  await setUserWritingGoals({ dataDir: cms.config.dataDir, userId: userId(cms, username), goals });
}

async function ledger(cms: Cms, username: string, contents: unknown): Promise<void> {
  const dir = path.join(cms.config.dataDir, 'writing');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${String(userId(cms, username))}.json`),
    typeof contents === 'string' ? contents : JSON.stringify(contents),
    'utf8',
  );
}

async function dashboard(agent: Browser): Promise<string> {
  const response = await agent.get('/admin');
  const html = await response.text();
  assert.equal(response.status, 200, html);
  return html;
}

/** The card's markup, or `undefined` when the dashboard does not draw it. */
async function card(agent: Browser): Promise<string | undefined> {
  const html = screenOf(await dashboard(agent));
  const start = html.indexOf(`<h2 class="card-title">${TITLE}</h2>`);
  if (start < 0) return undefined;
  return html.slice(start).split('<h2 class="card-title">')[1];
}

async function cardText(agent: Browser): Promise<string> {
  const found = await card(agent);
  assert.ok(found !== undefined, 'the Writing goal card is drawn');
  return text(found);
}

async function arrange(agent: Browser, action: string): Promise<void> {
  const token = csrfField(await dashboard(agent));
  assert.ok(token !== undefined);
  const response = await agent.post('/admin/dashboard/layout', {
    csrf_token: token,
    action,
    widget: KEY,
  });
  assert.equal(response.status, 303);
}

async function saveGoals(agent: Browser, fields: Record<string, string>): Promise<void> {
  const page = await agent.get('/admin/users/writing-goals');
  const token = csrfField(await page.text());
  assert.ok(token !== undefined);
  const response = await agent.post('/admin/users/writing-goals', {
    csrf_token: token,
    ...fields,
  });
  assert.equal(response.status, 303, await response.text());
}

describe('the Writing goal card (TASK-501)', () => {
  it('shows words this period against the goal, with a bar, a percentage and the pace (AC #1)', async () => {
    const { cms, agent } = await site();
    await track(cms, FIRST_ADMIN.username);
    await ledger(cms, FIRST_ADMIN.username, { days: ADA_DAYS });

    const html = await card(agent);
    assert.ok(html !== undefined);
    assert.match(
      html,
      /<progress class="progress progress-primary w-full" value="21000" max="31000"/,
    );
    const words = text(html);
    assert.match(words, /Words this month 21,000 of 31,000 · 67%/);
    assert.match(words, /1,000 words ahead of even pace \(20,000 by today\)\./);
  });

  it('says how far behind even pace the user is', async () => {
    const { cms, agent } = await site();
    await track(cms, FIRST_ADMIN.username, { ...MONTHLY, period: 'week', words: 7000 });
    await ledger(cms, FIRST_ADMIN.username, { days: { '2026-10-19': 500, '2026-10-20': 300 } });

    const words = await cardText(agent);
    assert.match(words, /Words this week 800 of 7,000 · 11%/);
    assert.match(words, /1,200 words behind even pace \(2,000 by today\)\./);
  });

  it('shows words today, the current and best streak, and what today still needs (AC #2)', async () => {
    const { cms, agent } = await site();
    await track(cms, FIRST_ADMIN.username);
    await ledger(cms, FIRST_ADMIN.username, { days: ADA_DAYS });

    const words = await cardText(agent);
    assert.match(words, /Words today 300/);
    assert.match(words, /Current streak \(days\) 4/);
    assert.match(words, /Best streak \(days\) 6/);
    assert.match(words, /Write 700 more words today to keep your streak going\./);
  });

  it('says when today has kept the streak going', async () => {
    const { cms, agent } = await site();
    await track(cms, FIRST_ADMIN.username);
    await ledger(cms, FIRST_ADMIN.username, { days: { ...ADA_DAYS, '2026-10-20': 1200 } });

    const words = await cardText(agent);
    assert.match(words, /Current streak \(days\) 5/);
    assert.match(words, /You have written enough today to keep your streak going\./);
  });

  it('asks for words to start a streak when there is none', async () => {
    const { cms, agent } = await site();
    await track(cms, FIRST_ADMIN.username);
    await ledger(cms, FIRST_ADMIN.username, { days: { '2026-10-01': 200 } });

    assert.match(await cardText(agent), /Write 1,000 words today to start a streak\./);
  });

  it('draws a calendar of words per day that marks the days that met the streak rule (AC #3)', async () => {
    const { cms, agent } = await site();
    await track(cms, FIRST_ADMIN.username);
    await ledger(cms, FIRST_ADMIN.username, { days: ADA_DAYS });

    const html = await card(agent);
    assert.ok(html !== undefined);
    assert.match(html, /<title>19 Oct 2026: 1,000\. Met the streak rule\.<\/title>/);
    assert.match(html, /<title>20 Oct 2026: 300<\/title>/);
    assert.match(html, /class="sr-only">Words per day, [^<]*Met the streak rule: 11 days\.<\/p>/);
  });

  it('shows each of two signed-in users their own figures, never the other’s (AC #4)', async () => {
    const { cms, agent: ada } = await site();
    await createUser({ dataDir: cms.config.dataDir, ...BOB });
    const bob = await signIn(cms, BOB);
    await track(cms, FIRST_ADMIN.username);
    await ledger(cms, FIRST_ADMIN.username, { days: ADA_DAYS });

    assert.match(await cardText(ada), /Words today 300/);
    assert.equal(await card(bob), undefined, 'Bob, not tracking, gets no card from Ada’s');

    await track(cms, BOB.username, { ...MONTHLY, words: 3100 });
    await ledger(cms, BOB.username, { days: { '2026-10-20': 42 } });
    const bobs = await cardText(bob);
    assert.match(bobs, /Words today 42/);
    assert.match(bobs, /Words this month 42 of 3,100/);
    assert.match(await cardText(ada), /Words today 300/);
  });

  it('can be collapsed, removed and added back like the other cards (AC #5)', async () => {
    const { cms, agent } = await site();
    await track(cms, FIRST_ADMIN.username);
    await ledger(cms, FIRST_ADMIN.username, { days: ADA_DAYS });
    assert.match(await dashboard(agent), new RegExp(`data-dashboard-card="${KEY}"`));

    await arrange(agent, 'collapse');
    assert.doesNotMatch(await cardText(agent), /Words today/);
    await arrange(agent, 'expand');
    assert.match(await cardText(agent), /Words today 300/);

    await arrange(agent, 'remove');
    assert.equal(await card(agent), undefined);
    assert.match(await dashboard(agent), /aria-label="Add back Writing goal"/);
    await arrange(agent, 'restore');
    assert.match(await cardText(agent), /Words today 300/);
  });

  it('is neither drawn nor offered until the user tracks writing goals, and goes when they stop (AC #7)', async () => {
    const { agent } = await site();
    assert.equal(await card(agent), undefined);
    assert.doesNotMatch(await dashboard(agent), /Writing goal/);

    await saveGoals(agent, {
      tracking: '1',
      words: '250',
      period: 'day',
      daily_words: '250',
      misses_allowed: '0',
    });
    assert.ok((await card(agent)) !== undefined, 'checking the box draws the card');

    await arrange(agent, 'remove');
    assert.match(await dashboard(agent), /aria-label="Add back Writing goal"/);

    await saveGoals(agent, {
      words: '250',
      period: 'day',
      daily_words: '250',
      misses_allowed: '0',
    });
    assert.equal(await card(agent), undefined);
    assert.doesNotMatch(await dashboard(agent), /Writing goal/, 'not offered under Add back');
  });

  it('says there are no words yet instead of drawing an empty chart (AC #8)', async () => {
    const { cms, agent } = await site();
    await track(cms, FIRST_ADMIN.username);

    const html = await card(agent);
    assert.ok(html !== undefined);
    assert.doesNotMatch(html, /<svg role="img"/);
    assert.match(text(html), /Words this month 0 of 31,000 · 0%/);
    assert.match(text(html), /No words written yet\./);
  });

  it('says the record of words written could not be read when the file is damaged', async () => {
    const { cms, agent } = await site();
    await track(cms, FIRST_ADMIN.username);
    await ledger(cms, FIRST_ADMIN.username, '{ not json');

    const words = await cardText(agent);
    assert.match(words, /Your record of words written could not be read/);
    assert.ok(warnings.some((warning) => warning.includes('words written')));
  });
});
