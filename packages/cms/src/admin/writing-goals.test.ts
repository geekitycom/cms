/**
 * Users > Writing goals (TASK-500): the signed-in user's own "Track writing
 * goals" switch, goal and streak rule.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { flashes } from './__testing__/flash.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { findUser } from '../site/users.ts';

const box = sandbox();
after(() => box.cleanup());

const SCREEN = '/admin/users/writing-goals';

async function site(): Promise<{ cms: Cms; agent: Browser }> {
  const cms = await box.site();
  return { cms, agent: await signedIn(cms) };
}

async function screen(agent: Browser): Promise<{ html: string; token: string }> {
  const response = await agent.get(SCREEN);
  const html = await response.text();
  assert.equal(response.status, 200, html);
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the screen carried a CSRF token');
  return { html, token };
}

async function save(agent: Browser, fields: Record<string, string>): Promise<Response> {
  const { token } = await screen(agent);
  return agent.post(SCREEN, { csrf_token: token, ...fields });
}

function storedGoals(cms: Cms) {
  return findUser(cms.config.dataDir, 'ada')?.writingGoals;
}

/** The text between a field's control and the next field. */
function fieldBlock(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start >= 0, `the page has #${id}`);
  const next = html.indexOf('class="fieldset"', start);
  return html.slice(start, next < 0 ? undefined : next);
}

const GOAL_FIELDS = ['goal-words', 'goal-period', 'streak-daily-words', 'streak-misses-allowed'];

describe('the writing goals screen', () => {
  it('starts with the switch off and no goal fields', async () => {
    const { agent } = await site();
    const { html } = await screen(agent);
    assert.match(
      html,
      /<input id="writing-tracking" name="tracking" type="checkbox" value="1"(?! checked)/,
    );
    assert.match(html, /Track writing goals/);
    for (const id of GOAL_FIELDS) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  });

  it('is in the Users menu', async () => {
    const { agent } = await site();
    const { html } = await screen(agent);
    assert.match(html, /<a[^>]*href="\/admin\/users\/writing-goals"[^>]*>\s*Writing goals/);
  });

  it('refuses tracking with no goal, and shows the goal fields with the message', async () => {
    const { cms, agent } = await site();
    const response = await save(agent, { tracking: '1' });
    const html = await response.text();
    assert.equal(response.status, 400);
    assert.match(fieldBlock(html, 'goal-words'), /Set a goal to track writing goals\./);
    for (const id of GOAL_FIELDS) assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, /id="writing-tracking"[^>]* checked/);
    assert.equal(storedGoals(cms), undefined);
  });

  it('defaults the streak words to the daily pace rounded up, and shows the fields once saved', async () => {
    const { cms, agent } = await site();
    const response = await save(agent, {
      tracking: '1',
      words: '100000',
      period: 'month',
      daily_words: '',
      misses_allowed: '1',
    });
    assert.equal(response.status, 303);
    assert.deepEqual(storedGoals(cms), {
      tracking: true,
      words: 100_000,
      period: 'month',
      streak: { dailyWords: 3334, missesAllowed: 1 },
    });

    const { html } = await screen(agent);
    assert.ok(flashes(html).some(({ kind }) => kind === 'notice'));
    assert.match(html, /id="writing-tracking"[^>]* checked/);
    assert.match(fieldBlock(html, 'goal-words'), /value="100000"/);
    assert.match(fieldBlock(html, 'goal-period'), /<option value="month" selected>/);
    assert.match(fieldBlock(html, 'streak-daily-words'), /value="3334"/);
  });

  it('defaults the streak words to the goal for a daily goal, and keeps words the user chose', async () => {
    const { cms, agent } = await site();
    await save(agent, {
      tracking: '1',
      words: '250',
      period: 'day',
      daily_words: '',
      misses_allowed: '0',
    });
    assert.equal(storedGoals(cms)?.streak.dailyWords, 250);

    await save(agent, {
      tracking: '1',
      words: '250',
      period: 'day',
      daily_words: '100',
      misses_allowed: '0',
    });
    assert.equal(storedGoals(cms)?.streak.dailyWords, 100);
  });

  for (const [field, value, id, message] of [
    ['words', '0', 'goal-words', /Enter a whole number of words above 0\./],
    ['words', '-5', 'goal-words', /Enter a whole number of words above 0\./],
    ['period', 'fortnight', 'goal-period', /Choose a day, a week, a month or a year\./],
    [
      'daily_words',
      '0',
      'streak-daily-words',
      /Enter a whole number of words above 0, or leave it empty/,
    ],
    ['misses_allowed', '8', 'streak-misses-allowed', /Enter a number of days from 0 to 7\./],
    ['misses_allowed', '-1', 'streak-misses-allowed', /Enter a number of days from 0 to 7\./],
  ] as const) {
    it(`refuses ${field} ${value} with a message next to the field`, async () => {
      const { cms, agent } = await site();
      const response = await save(agent, {
        tracking: '1',
        words: '250',
        period: 'day',
        daily_words: '',
        misses_allowed: '1',
        [field]: value,
      });
      const html = await response.text();
      assert.equal(response.status, 400);
      assert.match(fieldBlock(html, id), message);
      assert.match(fieldBlock(html, id), /aria-invalid="true"/);
      assert.match(html, /Nothing was saved/);
      assert.equal(storedGoals(cms), undefined);
    });
  }

  it('keeps the goal when tracking is turned off, and restores it when turned on again', async () => {
    const { cms, agent } = await site();
    await save(agent, {
      tracking: '1',
      words: '500',
      period: 'week',
      daily_words: '80',
      misses_allowed: '2',
    });
    const goal = { words: 500, period: 'week', streak: { dailyWords: 80, missesAllowed: 2 } };

    await save(agent, { words: '500', period: 'week', daily_words: '80', misses_allowed: '2' });
    assert.deepEqual(storedGoals(cms), { tracking: false, ...goal });
    const off = (await screen(agent)).html;
    for (const id of GOAL_FIELDS) assert.doesNotMatch(off, new RegExp(`id="${id}"`));

    // With the fields hidden, the form posts only the switch.
    const response = await save(agent, { tracking: '1' });
    assert.equal(response.status, 303);
    assert.deepEqual(storedGoals(cms), { tracking: true, ...goal });
  });

  it('turning tracking off with no goal saved stores nothing', async () => {
    const { cms, agent } = await site();
    const response = await save(agent, {});
    assert.equal(response.status, 303);
    assert.equal(storedGoals(cms), undefined);
  });
});
