import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';

import {
  NOTIFICATION_EVENTS,
  notificationMode,
  notificationWanted,
} from '../site/notification-preferences.ts';
import { findUser, usersFile, usersJsonText } from '../site/users.ts';
import type { User, UsersFileContents } from '../site/users.ts';
import { csrfField, FIRST_ADMIN, sandbox, signIn, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { addUser, writeUsers } from './__testing__/users.ts';
import { ADMIN_SECTIONS } from './menu.ts';

const box = sandbox();
after(() => box.cleanup());

const PAGE = '/admin/settings/notifications';

/** The page's HTML and the CSRF token on it. */
async function page(agent: Browser): Promise<{ html: string; token: string }> {
  const response = await agent.get(PAGE);
  assert.equal(response.status, 200);
  const html = await response.text();
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the page carries a CSRF token');
  return { html, token };
}

/** Save the page the way a browser would: every event shown, the named fields filled. */
async function save(agent: Browser, fields: Record<string, string>): Promise<Response> {
  const { token } = await page(agent);
  return agent.post(PAGE, {
    csrf_token: token,
    events: NOTIFICATION_EVENTS.map((event) => event.name).join(' '),
    ...fields,
  });
}

/** The stored record for a user, exactly as `data/users.json` holds it. */
function stored(dataDir: string, username: string): Record<string, unknown> | undefined {
  const file = JSON.parse(readFileSync(usersFile(dataDir), 'utf8')) as {
    users: Record<string, unknown>[];
  };
  return file.users.find((user) => user['username'] === username);
}

function userNamed(dataDir: string, username: string): User {
  const found = findUser(dataDir, username);
  assert.ok(found !== undefined, `there is a user called ${username}`);
  return found;
}

describe('Settings > Notifications', () => {
  it('is a child of Settings, after Email', () => {
    const settings = ADMIN_SECTIONS.find((section) => section.section === 'settings');
    const children = settings?.children.map((child) => child.child) ?? [];
    assert.equal(children[children.indexOf('email') + 1], 'notifications');
    assert.deepEqual(
      settings?.children.find((child) => child.child === 'notifications'),
      { child: 'notifications', label: 'Notifications', url: PAGE },
    );
  });

  it('lists every event with its label, description, switch and, when batched, how often', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const { html } = await page(agent);

    assert.match(html, /<h1\b[^>]*>Notifications<\/h1>/);
    assert.match(html, new RegExp(`<form[^>]*action="${PAGE}"`));
    for (const event of NOTIFICATION_EVENTS) {
      assert.match(html, new RegExp(event.label), `${event.name} is labelled`);
      assert.match(html, new RegExp(event.description.slice(0, 40)), `${event.name} is described`);
      assert.match(
        html,
        new RegExp(`<input[^>]*name="notify_${event.name}"[^>]*type="checkbox"`),
        `${event.name} has a switch`,
      );
      if (event.batched) {
        assert.match(html, new RegExp(`<select[^>]*name="mode_${event.name}"`));
        for (const label of ['As they arrive', 'Hourly digest', 'Daily digest']) {
          assert.match(html, new RegExp(label));
        }
      }
    }
  });

  it('says when there is no address or no mail provider to send with', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const { html } = await page(agent);
    assert.match(html, /no mail provider/i);
    assert.match(html, /href="\/admin\/settings\/email"/);
    assert.match(html, /no email address/i);
  });

  it('shows the signed-in user their own choices', async () => {
    const dataDir = await box.dir('geekity-notifications-data-');
    writeUsers(dataDir, [{ username: FIRST_ADMIN.username }, { username: 'grace' }]);
    const cms = await box.open({ contentDir: await box.dir('geekity-notifications-'), dataDir });

    const grace = await signIn(cms, { username: 'grace', password: FIRST_ADMIN.password });
    await save(grace, { mode_comments: 'daily' });

    const ada = await signIn(cms);
    const { html } = await page(ada);
    assert.match(html, /<input[^>]*name="notify_comments"[^>]*checked/);
    assert.match(html, /<option value="immediately" selected>/, 'ada sees her own mode');

    const back = await page(grace);
    assert.match(back.html, /<option value="daily" selected>/, 'and grace sees hers');
  });
  it('reads preferences stored under the comments name before the page existed', async () => {
    const cms = await box.site();
    const { dataDir } = cms.config;
    const agent = await signedIn(cms);
    const file = JSON.parse(readFileSync(usersFile(dataDir), 'utf8')) as UsersFileContents;
    writeFileSync(
      usersFile(dataDir),
      usersJsonText({
        ...file,
        users: file.users.map((user) => ({
          ...user,
          notifications: { comments: false },
          notificationModes: { comments: 'hourly' },
        })),
      }),
    );

    const { html } = await page(agent);
    assert.doesNotMatch(html, /<input[^>]*name="notify_comments"[^>]*checked/);
    assert.match(html, /<option value="hourly" selected>/);
  });
});

describe('saving Settings > Notifications', () => {
  it('saves the signed-in user and never another', async () => {
    const cms = await box.site();
    const { dataDir } = cms.config;
    const agent = await signedIn(cms);
    addUser({ dataDir, username: 'grace', password: 'a password of her own' });

    const response = await save(agent, { mode_comments: 'hourly' });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), PAGE);
    const ada = userNamed(dataDir, 'ada');
    assert.equal(notificationWanted(ada, 'comments'), false, 'an unticked box is off');
    assert.equal(notificationMode(ada, 'comments'), 'hourly');

    const grace = userNamed(dataDir, 'grace');
    assert.equal(notificationWanted(grace, 'comments'), true, 'grace is untouched');
    assert.equal(notificationMode(grace, 'comments'), 'immediately');
    assert.equal(stored(dataDir, 'grace')?.['notifications'], undefined);
    assert.equal(stored(dataDir, 'grace')?.['notificationModes'], undefined);

    assert.match((await page(agent)).html, /saved/i);
  });

  it('writes only what differs from each default', async () => {
    const cms = await box.site();
    const { dataDir } = cms.config;
    const agent = await signedIn(cms);

    await save(agent, { notify_comments: '1', mode_comments: 'daily' });
    assert.equal(stored(dataDir, 'ada')?.['notifications'], undefined, 'on is the default');
    assert.deepEqual(stored(dataDir, 'ada')?.['notificationModes'], { comments: 'daily' });

    await save(agent, { notify_comments: '1', mode_comments: 'immediately' });
    assert.equal(stored(dataDir, 'ada')?.['notifications'], undefined);
    assert.equal(stored(dataDir, 'ada')?.['notificationModes'], undefined, 'back to the default');

    await save(agent, { mode_comments: 'immediately' });
    assert.deepEqual(stored(dataDir, 'ada')?.['notifications'], { comments: false });
  });

  it('drops an unknown event and an unknown mode', async () => {
    const cms = await box.site();
    const { dataDir } = cms.config;
    const agent = await signedIn(cms);
    await save(agent, { notify_comments: '1', mode_comments: 'hourly' });

    const { token } = await page(agent);
    const response = await agent.post(PAGE, {
      csrf_token: token,
      events: 'comments a-future-event',
      notify_comments: '1',
      'notify_a-future-event': '1',
      mode_comments: 'every-third-tuesday',
      'mode_a-future-event': 'daily',
    });

    assert.equal(response.status, 303);
    assert.equal(stored(dataDir, 'ada')?.['notifications'], undefined);
    assert.equal(
      stored(dataDir, 'ada')?.['notificationModes'],
      undefined,
      'an unknown mode reads as the default and is not stored',
    );
    assert.equal(notificationMode(userNamed(dataDir, 'ada'), 'comments'), 'immediately');
  });

  it('leaves alone an event the form did not show', async () => {
    const cms = await box.site();
    const { dataDir } = cms.config;
    const agent = await signedIn(cms);
    await save(agent, { mode_comments: 'daily' });

    const { token } = await page(agent);
    await agent.post(PAGE, { csrf_token: token, events: '' });

    assert.deepEqual(stored(dataDir, 'ada')?.['notifications'], { comments: false });
    assert.deepEqual(stored(dataDir, 'ada')?.['notificationModes'], { comments: 'daily' });
  });
});
