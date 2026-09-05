import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { addContactMessage, listContactMessages } from '../contact/records.ts';
import type { NewContactMessage } from '../contact/records.ts';
import type { Cms } from '../index.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { MESSAGES_DELETE_PATH, MESSAGES_PATH, MESSAGES_READ_PATH } from './messages.ts';

/**
 * The Messages screen: what the contact form left behind, and the two things
 * that can be done about one.
 *
 * Everything goes through the app and through a signed-in browser, because the
 * acceptance criterion is that a message is listed, can be read and can be
 * deleted — none of which is a fact about a function.
 */

const box = sandbox();
after(() => box.cleanup());

/** One message already on disk when the screen is opened. */
function message(overrides: Partial<NewContactMessage> = {}): NewContactMessage {
  return {
    received: '2026-09-20T12:00:00.000Z',
    status: 'received',
    page: { slug: 'contact', permalink: '/contact/', title: 'Say hello' },
    from: { name: 'Ada Lovelace', email: 'ada@example.com' },
    subject: 'About the analytical engine',
    message: 'It is a lovely machine. Please write back.',
    addressHash: 'abcdef0123456789abcdef0123456789',
    ...overrides,
  };
}

/** A signed-in site whose `data/contact` already holds these messages. */
async function siteWith(
  messages: NewContactMessage[] = [message()],
): Promise<{ cms: Cms; agent: Browser }> {
  const cms = await box.site();
  const agent = await signedIn(cms);
  for (const one of messages) await addContactMessage(cms.config.dataDir, one);
  return { cms, agent };
}

/** The screen's HTML, and the CSRF token its forms carry. */
async function screen(agent: Browser, url = MESSAGES_PATH): Promise<string> {
  const response = await agent.get(url);
  assert.equal(response.status, 200);
  return await response.text();
}

describe('the Messages screen', () => {
  it('lists what the contact form stored (AC #2)', async () => {
    const { agent } = await siteWith();
    const html = await screen(agent);

    assert.match(html, /Ada Lovelace/);
    assert.match(html, /ada@example\.com/);
    assert.match(html, /About the analytical engine/);
    assert.match(html, /It is a lovely machine\./);
    assert.match(html, /Say hello/, 'the page the form was on');
  });

  it('is in the admin navigation', async () => {
    const { agent } = await siteWith([]);
    const html = await screen(agent, '/admin');

    assert.match(html, new RegExp(`href="${MESSAGES_PATH}"`));
  });

  it('says so when there is nothing', async () => {
    const { agent } = await siteWith([]);
    assert.match(await screen(agent, MESSAGES_PATH), /Nothing here/);
  });

  it('marks a message read, and unread again (AC #2)', async () => {
    const { cms, agent } = await siteWith();
    const token = csrfField(await screen(agent));
    assert.ok(token !== undefined);

    const id = listContactMessages(cms.config.dataDir)[0]?.id;
    assert.ok(id !== undefined);

    const read = await agent.post(MESSAGES_READ_PATH, { csrf_token: token, id, read: '1' });
    assert.equal(read.status, 303);
    assert.equal(listContactMessages(cms.config.dataDir)[0]?.read, true);

    const unread = await agent.post(MESSAGES_READ_PATH, { csrf_token: token, id, read: '' });
    assert.equal(unread.status, 303);
    assert.equal(listContactMessages(cms.config.dataDir)[0]?.read, false);
  });

  it('deletes a message, taking its file with it (AC #2)', async () => {
    const { cms, agent } = await siteWith();
    const token = csrfField(await screen(agent));
    assert.ok(token !== undefined);

    const id = listContactMessages(cms.config.dataDir)[0]?.id;
    assert.ok(id !== undefined);

    const response = await agent.post(MESSAGES_DELETE_PATH, { csrf_token: token, id });

    assert.equal(response.status, 303);
    assert.equal(listContactMessages(cms.config.dataDir).length, 0);
  });

  it('keeps what a checker called spam on a list of its own', async () => {
    const { agent } = await siteWith([
      message(),
      message({
        status: 'spam',
        from: { name: 'A Robot', email: 'robot@spam.example' },
        subject: 'Buy my things',
      }),
    ]);

    const inbox = await screen(agent, MESSAGES_PATH);
    assert.match(inbox, /Ada Lovelace/);
    assert.doesNotMatch(inbox, /A Robot/, 'spam is not in the inbox');

    const spam = await screen(agent, `${MESSAGES_PATH}?status=spam`);
    assert.match(spam, /A Robot/);
    assert.doesNotMatch(spam, /Ada Lovelace/);
  });

  it('counts what is unread on the dashboard', async () => {
    const { agent } = await siteWith([message(), message({ read: true })]);
    const html = await screen(agent, '/admin');

    assert.match(
      html,
      new RegExp(`Messages unread[\\s\\S]*?<a href="${MESSAGES_PATH}">1</a>`),
      'the dashboard says how many are waiting and links here',
    );
  });

  it('refuses an id that is not one, without touching anything', async () => {
    const { cms, agent } = await siteWith();
    const token = csrfField(await screen(agent));
    assert.ok(token !== undefined);

    const response = await agent.post(MESSAGES_DELETE_PATH, {
      csrf_token: token,
      id: '../../users.json',
    });

    assert.equal(response.status, 303, 'a flash and a redirect, like every other bad id');
    assert.equal(listContactMessages(cms.config.dataDir).length, 1);
  });
});
