import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import {
  NOTIFICATION_EVENTS,
  notificationMode,
  notificationWanted,
} from '../notifications/preferences.ts';
import { countUsers, createUser, findUser, findUserById, verifyUserPassword } from './accounts.ts';
import { writeUsers } from './__testing__/users.ts';
import {
  browser,
  csrfField,
  FIRST_ADMIN,
  sandbox,
  signIn,
  signedIn,
} from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

/** The users screen's HTML, and the CSRF token that goes with it. */
async function usersScreen(agent: Browser): Promise<{ html: string; token: string }> {
  const html = await (await agent.get('/admin/users')).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the users screen carried a CSRF token');
  return { html, token };
}

/** One user's edit screen, and the CSRF token that goes with it. */
async function editScreen(agent: Browser, id: number): Promise<{ html: string; token: string }> {
  const response = await agent.get(`/admin/users/${String(id)}`);
  assert.equal(response.status, 200, 'the edit screen answered');
  const html = await response.text();
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the edit screen carried a CSRF token');
  return { html, token };
}

/**
 * Every box on a screen a person has to read a label for — so a test can say
 * that each of them has one, rather than naming the fields it happens to
 * remember. Hidden fields are not boxes and need no label.
 */
function boxes(html: string): { id: string | undefined; tag: string }[] {
  const found: { id: string | undefined; tag: string }[] = [];
  for (const [tag] of html.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)) {
    if (tag.includes('type="hidden"')) continue;
    found.push({ id: /\bid="([^"]+)"/.exec(tag)?.[1], tag });
  }
  return found;
}

/** The `<label for="…">` opening tag bound to that box, if there is one. */
function labelFor(html: string, id: string): string | undefined {
  return new RegExp(`<label[^>]*\\bfor="${id}"[^>]*>`).exec(html)?.[0];
}

/** The id of the user of that name, which every test here needs to build a URL. */
function idOf(dataDir: string, username: string): number {
  const user = findUser(dataDir, username);
  assert.ok(user !== undefined, `there is a user called ${username}`);
  return user.id;
}

describe('the users screen', () => {
  it('lists every user, marking the one who is signed in', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'a password of her own',
    });

    const { html } = await usersScreen(agent);

    assert.match(html, /ada/, 'the signed-in admin is listed');
    assert.match(html, /grace/, 'the other user is listed');
    assert.match(html, /ada[\s\S]{0,200}\(you\)/, 'the signed-in admin is marked');
  });
});

describe('the edit user screen (TASK-97 AC #1, #7)', () => {
  it('is a screen of its own that the list links to', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = idOf(cms.config.dataDir, 'ada');

    const list = await (await agent.get('/admin/users')).text();
    assert.match(
      list,
      new RegExp(`href="/admin/users/${String(ada)}"[^>]*>\\s*Edit`),
      'the list offers Edit per row',
    );

    const { html } = await editScreen(agent, ada);
    assert.match(html, /<title>Edit ada/, 'the edit page has a title of its own');
    assert.match(html, /class="admin-nav"/, 'and renders inside the admin chrome');
    assert.match(
      html,
      /href="\/admin\/users"[^>]*aria-current="page"/,
      'with All users still marked in the menu',
    );
  });

  it('leaves the chrome saying who is signed in, not who is being edited', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const grace = (
      await createUser({
        dataDir: cms.config.dataDir,
        username: 'grace',
        password: 'a password of her own',
      })
    ).id;

    const { html } = await editScreen(agent, grace);

    assert.match(html, /Signed in as ada/, 'the bar is about the browser, not the page');
    assert.doesNotMatch(html, /Signed in as grace/);
  });

  it('leaves the list with nothing on it that edits anybody', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'a password of her own',
      email: 'grace@example.com',
    });

    const { html } = await usersScreen(agent);

    // Username with the archive under it, email, created, and the actions.
    assert.match(html, /<th scope="col">Username<\/th>/);
    assert.match(html, /<th scope="col">Email<\/th>/);
    assert.match(html, /<th scope="col">Created<\/th>/);
    assert.match(html, /grace@example\.com/, 'the address is shown, not offered as a box');
    assert.match(html, /href="\/author\/grace\/"/, 'the archive URL is still under the name');

    for (const name of ['display_name', 'bio', 'avatar', 'job_title', 'location', 'links']) {
      assert.doesNotMatch(html, new RegExp(`name="${name}"`), `no ${name} box in the table`);
    }
    assert.doesNotMatch(html, /name="email"/, 'no email box in the table');
    assert.doesNotMatch(html, /name="mode"/, 'no how-often select in the table');
    assert.doesNotMatch(html, /name="event"/, 'no notice switch in the table');
    assert.doesNotMatch(html, /admin-visually-hidden/, 'and so no hidden labels either');
    assert.doesNotMatch(html, /Change your password/, 'which belongs on your own page');
  });
});

describe('the fields on the edit user screen (TASK-97 AC #2)', () => {
  it('gives every box a label the eye can read', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = idOf(cms.config.dataDir, 'ada');

    const { html } = await editScreen(agent, ada);

    const found = boxes(html);
    assert.ok(found.length >= 8, `the screen has its fields, saw ${String(found.length)}`);
    for (const { id, tag } of found) {
      assert.ok(id !== undefined, `every box has an id: ${tag}`);
      const label = labelFor(html, id);
      assert.ok(label !== undefined, `${id} has a label bound to it`);
      assert.doesNotMatch(label, /admin-visually-hidden/, `${id}'s label is not hidden from sight`);
    }
  });

  it('holds the account, the profile and what this person is emailed about', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = idOf(cms.config.dataDir, 'ada');

    const { html } = await editScreen(agent, ada);

    assert.match(html, /<h2>Account<\/h2>/);
    assert.match(html, /<h2>Profile<\/h2>/);
    assert.match(html, /<h2>Email me about<\/h2>/);

    // The username is shown, not offered as a box: it is the author URL, the
    // login and the actor, and nothing here may change it.
    assert.match(html, /href="\/author\/ada\/"/, 'the archive URL is on the screen');
    assert.doesNotMatch(html, /name="username"/, 'and the name itself is not editable');

    for (const label of [
      'Email address',
      'Display name',
      'Bio',
      'Avatar',
      'Job title',
      'Location',
      'Links',
    ]) {
      assert.match(html, new RegExp(`<label[^>]*>${label}`), `${label} is a visible label`);
    }

    const [notice] = NOTIFICATION_EVENTS;
    assert.ok(notice !== undefined);
    assert.match(html, new RegExp(notice.label), 'the notices are on this screen');
    assert.match(html, new RegExp(notice.description.slice(0, 40)), 'with what each one sends');
    assert.match(html, /<label[^>]*>How often/, 'and a labelled select for a batched one');
  });

  it('shows what is already stored, in the boxes that hold it', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = idOf(cms.config.dataDir, 'ada');
    const { token } = await editScreen(agent, ada);

    await agent.post('/admin/users/profile', {
      csrf_token: token,
      user_id: String(ada),
      display_name: 'Ada Lovelace',
      bio: 'Wrote the first program.',
      avatar: '',
      job_title: 'Analyst',
      location: 'London',
      links: 'Her notes | https://ada.example',
    });

    const { html } = await editScreen(agent, ada);
    assert.match(html, /value="Ada Lovelace"/);
    assert.match(html, /Wrote the first program\./);
    assert.match(html, /value="Analyst"/);
    assert.match(html, /value="London"/);
    assert.match(html, /Her notes \| https:\/\/ada\.example/);
  });
});

describe('saving from the edit user screen (TASK-97 AC #3)', () => {
  it('puts the email address back on that page, showing what changed', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const grace = (
      await createUser({
        dataDir: cms.config.dataDir,
        username: 'grace',
        password: 'a password of her own',
      })
    ).id;
    const { token } = await editScreen(agent, grace);

    const saved = await agent.post('/admin/users/email', {
      csrf_token: token,
      user_id: String(grace),
      email: 'grace@example.com',
    });

    assert.equal(saved.status, 303);
    assert.equal(saved.headers.get('location'), `/admin/users/${String(grace)}`);

    const { html } = await editScreen(agent, grace);
    assert.match(html, /will be emailed at grace@example\.com/, 'the page says what happened');
    assert.match(html, /value="grace@example\.com"/, 'and the box holds the new address');
  });

  it('comes back to the page when the address is refused, with nothing stored', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = idOf(cms.config.dataDir, 'ada');
    const { token } = await editScreen(agent, ada);

    const refused = await agent.post('/admin/users/email', {
      csrf_token: token,
      user_id: String(ada),
      email: 'not-an-address',
    });

    assert.equal(refused.status, 303);
    assert.equal(refused.headers.get('location'), `/admin/users/${String(ada)}`);
    assert.equal(findUser(cms.config.dataDir, 'ada')?.email, undefined, 'nothing was stored');
    assert.match((await editScreen(agent, ada)).html, /email address looks like/i);
  });

  it('puts the profile back on that page', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = idOf(cms.config.dataDir, 'ada');
    const { token } = await editScreen(agent, ada);

    const saved = await agent.post('/admin/users/profile', {
      csrf_token: token,
      user_id: String(ada),
      display_name: 'Ada Lovelace',
      bio: '',
      avatar: '',
      links: '',
    });

    assert.equal(saved.status, 303);
    assert.equal(saved.headers.get('location'), `/admin/users/${String(ada)}`);

    const { html } = await editScreen(agent, ada);
    assert.match(html, /Saved ada’s profile\./);
    assert.match(html, /value="Ada Lovelace"/);
  });

  it('puts a notice switch and a how-often back on that page', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = idOf(cms.config.dataDir, 'ada');
    const { token } = await editScreen(agent, ada);

    const off = await agent.post('/admin/users/notifications', {
      csrf_token: token,
      user_id: String(ada),
      event: 'comments',
    });

    assert.equal(off.status, 303);
    assert.equal(off.headers.get('location'), `/admin/users/${String(ada)}`);

    const after = await editScreen(agent, ada);
    assert.match(after.html, /will not be emailed about new comments\./);
    assert.match(after.html, /<button type="submit">Turn on<\/button>/, 'the switch shows as off');

    const daily = await agent.post('/admin/users/notifications/mode', {
      csrf_token: token,
      user_id: String(ada),
      event: 'comments',
      mode: 'daily',
    });

    assert.equal(daily.status, 303);
    assert.equal(daily.headers.get('location'), `/admin/users/${String(ada)}`);

    const { html } = await editScreen(agent, ada);
    assert.match(html, /one daily digest of new comments/);
    assert.match(html, /<option value="daily" selected>/, 'and the select holds the choice');
  });

  it('lands on the list when the user the form named is already gone', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = idOf(cms.config.dataDir, 'ada');
    const { token } = await editScreen(agent, ada);

    const response = await agent.post('/admin/users/profile', {
      csrf_token: token,
      user_id: '404',
      display_name: 'Nobody',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/users');
    assert.match(await (await agent.get('/admin/users')).text(), /already gone/i);
  });
});

describe('adding a user', () => {
  it('is a screen of its own that the list links to (TASK-72)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const list = await (await agent.get('/admin/users')).text();
    assert.match(list, /href="\/admin\/users\/new"/, 'the list offers Add new');
    assert.doesNotMatch(list, /id="add-username"/, 'and does not carry the form itself');

    const response = await agent.get('/admin/users/new');
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /id="add-username"/, 'the add form is here');
    assert.match(html, /action="\/admin\/users\/new"/, 'and posts to this screen');
    assert.doesNotMatch(html, /Change your password/, 'which is about somebody else');
  });

  it('keeps its URL, which is never read as an id (TASK-97 AC #6)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const form = await agent.get('/admin/users/new');
    assert.equal(form.status, 200);
    assert.match(await form.text(), /<title>Add new user/, 'Add new is still the add screen');

    // A number no user has, and a segment that is not a number at all.
    assert.equal((await agent.get('/admin/users/404')).status, 404);
    assert.equal((await agent.get('/admin/users/nobody')).status, 404);
  });

  it('creates somebody who can then log in (AC #1)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { token } = await usersScreen(agent);

    const response = await agent.post('/admin/users/new', {
      csrf_token: token,
      username: 'grace',
      password: 'a password of her own',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/users');

    const grace = await signIn(cms, { username: 'grace', password: 'a password of her own' });
    const dashboard = await (await grace.get('/admin')).text();
    assert.match(dashboard, /Signed in as grace/);
  });

  it('generates a password on request and shows it once, and it is the real one', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { token } = await usersScreen(agent);

    await agent.post('/admin/users/new', {
      csrf_token: token,
      username: 'grace',
      password: '',
      generate: '1',
    });

    const after = await (await agent.get('/admin/users')).text();
    const shown = /Their password is ([^\s]+) /.exec(after)?.[1];
    assert.ok(shown !== undefined, 'the generated password was shown once');

    // The password on the screen is the one that was stored, not a decoration.
    const grace = await signIn(cms, { username: 'grace', password: shown });
    assert.match(await (await grace.get('/admin')).text(), /Signed in as grace/);

    // Shown once: the flash is cleared by the page that renders it.
    assert.doesNotMatch(await (await agent.get('/admin/users')).text(), /Their password is/);
  });
});

describe('a user email address (AC #1)', () => {
  it('is taken by the add form and shown in the table', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { token } = await usersScreen(agent);

    await agent.post('/admin/users/new', {
      csrf_token: token,
      username: 'grace',
      password: 'a password of her own',
      email: 'grace@example.com',
    });

    assert.equal(findUser(cms.config.dataDir, 'grace')?.email, 'grace@example.com');
    assert.match((await usersScreen(agent)).html, /grace@example\.com/);
  });

  it('is set and cleared on a row, including somebody else’s', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const grace = await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'a password of her own',
    });
    const { token } = await usersScreen(agent);

    const saved = await agent.post('/admin/users/email', {
      csrf_token: token,
      user_id: String(grace.id),
      email: 'grace@example.com',
    });
    assert.equal(saved.status, 303);
    assert.equal(findUser(cms.config.dataDir, 'grace')?.email, 'grace@example.com');

    await agent.post('/admin/users/email', {
      csrf_token: token,
      user_id: String(grace.id),
      email: '',
    });
    assert.equal(findUser(cms.config.dataDir, 'grace')?.email, undefined);
  });

  it('refuses something that is not an address, and stores nothing', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = findUser(cms.config.dataDir, 'ada');
    assert.ok(ada !== undefined);
    const { token } = await usersScreen(agent);

    const response = await agent.post('/admin/users/email', {
      csrf_token: token,
      user_id: String(ada.id),
      email: 'not-an-address',
    });

    assert.equal(response.status, 303);
    assert.equal(findUser(cms.config.dataDir, 'ada')?.email, undefined);
    assert.match(await (await agent.get('/admin/users')).text(), /email address looks like/i);
  });
});

describe('a user profile (TASK-67 AC #1)', () => {
  it('is edited on a row and stored in the users file', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = findUser(cms.config.dataDir, 'ada');
    assert.ok(ada !== undefined);
    const { token } = await usersScreen(agent);

    const saved = await agent.post('/admin/users/profile', {
      csrf_token: token,
      user_id: String(ada.id),
      display_name: 'Ada Lovelace',
      bio: 'Wrote the first program.',
      avatar: '/uploads/2026/09/ada.jpg',
      job_title: 'Analyst',
      location: 'London',
      links: 'Her notes | https://ada.example\nhttps://bare.example',
    });

    assert.equal(saved.status, 303);
    const stored = findUserById(cms.config.dataDir, ada.id)?.profile;
    assert.equal(stored?.displayName, 'Ada Lovelace');
    assert.equal(stored?.bio, 'Wrote the first program.');
    assert.equal(stored?.avatar, '/uploads/2026/09/ada.jpg');
    assert.equal(stored?.jobTitle, 'Analyst');
    assert.equal(stored?.location, 'London');
    assert.deepEqual(stored?.links, [
      { label: 'Her notes', href: 'https://ada.example' },
      // A line with no label is its own label, so a bare URL still renders.
      { label: 'https://bare.example', href: 'https://bare.example' },
    ]);
  });

  it('is edited on somebody else’s row too, and cleared when emptied', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const grace = await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'a password of her own',
    });
    const { token } = await usersScreen(agent);

    await agent.post('/admin/users/profile', {
      csrf_token: token,
      user_id: String(grace.id),
      display_name: 'Grace Hopper',
      bio: '',
      avatar: '',
      links: '',
    });
    assert.equal(findUserById(cms.config.dataDir, grace.id)?.profile?.displayName, 'Grace Hopper');

    await agent.post('/admin/users/profile', {
      csrf_token: token,
      user_id: String(grace.id),
      display_name: '',
      bio: '',
      avatar: '',
      links: '',
    });
    assert.equal(findUserById(cms.config.dataDir, grace.id)?.profile, undefined);
  });

  it('says so when the row is already gone', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { token } = await usersScreen(agent);

    const response = await agent.post('/admin/users/profile', {
      csrf_token: token,
      user_id: '404',
      display_name: 'Nobody',
    });

    assert.equal(response.status, 303);
    assert.match(await (await agent.get('/admin/users')).text(), /already gone/i);
  });
});

describe('a stored actor id (TASK-69 AC #5)', () => {
  /** What the WordPress ActivityPub plugin published this person as. */
  const STORED = 'https://andrewshell.org/?author=2';

  /**
   * A site whose admin was published under {@link STORED} elsewhere, signed
   * in. The account is written before the boot because no screen sets a stored
   * id — the import does (TASK-71), or somebody editing the file.
   */
  async function migrated(): Promise<{ agent: Browser; dataDir: string }> {
    const dataDir = await box.dir('geekity-users-data-');
    writeUsers(dataDir, [
      { username: FIRST_ADMIN.username, password: FIRST_ADMIN.password, actorId: STORED },
    ]);
    const cms = await box.open({
      contentDir: await box.dir('geekity-users-content-'),
      dataDir,
    });
    return { agent: await signIn(cms), dataDir };
  }

  it('is shown on their own screen, read-only, with what it means', async () => {
    const { agent, dataDir } = await migrated();

    const { html } = await editScreen(agent, idOf(dataDir, FIRST_ADMIN.username));

    assert.match(html, /https:\/\/andrewshell\.org\/\?author=2/, 'the id is on the screen');
    assert.match(html, /the fediverse knows/i, 'and the screen says what it is');
    assert.doesNotMatch(
      html,
      /<input[^>]+value="https:\/\/andrewshell\.org\/\?author=2"/,
      'it is not an editable field: only the import or the file sets one',
    );
  });

  it('is left alone by a profile save, and absent for a user without one', async () => {
    const { agent, dataDir } = await migrated();
    const { token } = await usersScreen(agent);
    const ada = findUser(dataDir, FIRST_ADMIN.username);
    assert.ok(ada !== undefined);

    await agent.post('/admin/users/profile', {
      csrf_token: token,
      user_id: String(ada.id),
      display_name: 'Ada Lovelace',
      bio: '',
      avatar: '',
      links: '',
    });

    assert.equal(findUser(dataDir, FIRST_ADMIN.username)?.actorId, STORED);

    // A site nobody migrated says nothing about one at all.
    const plain = await box.site();
    const other = await signedIn(plain);
    const { html } = await editScreen(other, idOf(plain.config.dataDir, FIRST_ADMIN.username));
    assert.doesNotMatch(html, /the fediverse knows/i);
  });
});

describe('notification preferences (AC #3)', () => {
  it('offers a switch for every event the registry knows', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const { html } = await editScreen(agent, idOf(cms.config.dataDir, 'ada'));

    for (const event of NOTIFICATION_EVENTS) {
      assert.match(html, new RegExp(`value="${event.name}"`), `${event.name} has a switch`);
      assert.match(html, new RegExp(event.label));
    }
  });

  it('is on until somebody turns it off, and stays off', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = findUser(cms.config.dataDir, 'ada');
    assert.ok(ada !== undefined);
    const { token } = await usersScreen(agent);

    assert.equal(notificationWanted(findUserById(cms.config.dataDir, ada.id), 'comments'), true);

    const off = await agent.post('/admin/users/notifications', {
      csrf_token: token,
      user_id: String(ada.id),
      event: 'comments',
    });

    assert.equal(off.status, 303);
    assert.equal(notificationWanted(findUserById(cms.config.dataDir, ada.id), 'comments'), false);

    await agent.post('/admin/users/notifications', {
      csrf_token: token,
      user_id: String(ada.id),
      event: 'comments',
      on: '1',
    });
    assert.equal(notificationWanted(findUserById(cms.config.dataDir, ada.id), 'comments'), true);
  });

  it('ignores an event nothing in this version has ever heard of', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = findUser(cms.config.dataDir, 'ada');
    assert.ok(ada !== undefined);
    const { token } = await usersScreen(agent);

    const response = await agent.post('/admin/users/notifications', {
      csrf_token: token,
      user_id: String(ada.id),
      event: 'a-future-event',
    });

    assert.equal(response.status, 303);
    assert.deepEqual(findUserById(cms.config.dataDir, ada.id)?.notifications, undefined);
  });
});

describe('how often a notice arrives (AC #1)', () => {
  it('offers immediately, hourly and daily for an event that can be batched', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const { html } = await editScreen(agent, idOf(cms.config.dataDir, 'ada'));

    for (const event of NOTIFICATION_EVENTS.filter((candidate) => candidate.batched)) {
      assert.match(html, new RegExp(`value="${event.name}"`), `${event.name} has a mode form`);
    }
    for (const mode of ['immediately', 'hourly', 'daily']) {
      assert.match(html, new RegExp(`value="${mode}"`), `${mode} is offered`);
    }
  });

  it('is immediate until somebody chooses otherwise, and stores only the difference', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = findUser(cms.config.dataDir, 'ada');
    assert.ok(ada !== undefined);
    const { token } = await usersScreen(agent);

    assert.equal(
      notificationMode(findUserById(cms.config.dataDir, ada.id), 'comments'),
      'immediately',
    );

    const daily = await agent.post('/admin/users/notifications/mode', {
      csrf_token: token,
      user_id: String(ada.id),
      event: 'comments',
      mode: 'daily',
    });

    assert.equal(daily.status, 303);
    assert.equal(notificationMode(findUserById(cms.config.dataDir, ada.id), 'comments'), 'daily');
    assert.deepEqual(findUserById(cms.config.dataDir, ada.id)?.notificationModes, {
      comments: 'daily',
    });

    await agent.post('/admin/users/notifications/mode', {
      csrf_token: token,
      user_id: String(ada.id),
      event: 'comments',
      mode: 'immediately',
    });

    assert.equal(
      notificationMode(findUserById(cms.config.dataDir, ada.id), 'comments'),
      'immediately',
    );
    assert.deepEqual(
      findUserById(cms.config.dataDir, ada.id)?.notificationModes,
      undefined,
      'the default is not written down',
    );
  });

  it('reads a mode this version has never heard of as immediately, and drops it', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = findUser(cms.config.dataDir, 'ada');
    assert.ok(ada !== undefined);
    const { token } = await usersScreen(agent);

    await agent.post('/admin/users/notifications/mode', {
      csrf_token: token,
      user_id: String(ada.id),
      event: 'comments',
      mode: 'every-third-tuesday',
    });

    assert.equal(
      notificationMode(findUserById(cms.config.dataDir, ada.id), 'comments'),
      'immediately',
    );
    assert.deepEqual(findUserById(cms.config.dataDir, ada.id)?.notificationModes, undefined);
  });
});

describe('a bad add form', () => {
  it('refuses a name that could not be an author URL (TASK-67 AC #4)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { token } = await usersScreen(agent);

    const response = await agent.post('/admin/users/new', {
      csrf_token: token,
      username: '..',
      password: 'a password of their own',
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /author URL/);
    assert.equal(countUsers(cms.config.dataDir), 1, 'nothing was written');
  });

  it('comes back with a 400, what was typed, and nobody created', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { token } = await usersScreen(agent);

    const response = await agent.post('/admin/users/new', {
      csrf_token: token,
      username: 'grace hopper',
      password: 'a password of her own',
    });

    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /A username is 1 to 64 letters/);
    assert.match(html, /value="grace hopper"/, 'the field still holds what was typed');
    assert.equal(countUsers(cms.config.dataDir), 1, 'nothing was written');
  });

  it('refuses a password the setup form would have refused', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { token } = await usersScreen(agent);

    const response = await agent.post('/admin/users/new', {
      csrf_token: token,
      username: 'grace',
      password: 'short',
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /A password is at least 8 characters/);
    assert.equal(findUser(cms.config.dataDir, 'grace'), undefined);
  });

  it('refuses a name that is already taken', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { token } = await usersScreen(agent);

    const response = await agent.post('/admin/users/new', {
      csrf_token: token,
      username: 'ada',
      password: 'a completely different password',
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /already exists/);
    assert.equal(countUsers(cms.config.dataDir), 1);
    // The name was not quietly given the new password either.
    assert.ok(verifyUserPassword(cms.config.dataDir, 'ada', FIRST_ADMIN.password) !== undefined);
  });
});

describe('changing your own password', () => {
  it('is offered on your own page and on nobody else’s (TASK-97 AC #4)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = idOf(cms.config.dataDir, 'ada');
    const grace = (
      await createUser({
        dataDir: cms.config.dataDir,
        username: 'grace',
        password: 'a password of her own',
      })
    ).id;

    const mine = await editScreen(agent, ada);
    assert.match(mine.html, /<h2>Change your password<\/h2>/, 'on your own page');
    assert.match(mine.html, /id="current-password"/);

    const hers = await editScreen(agent, grace);
    assert.doesNotMatch(hers.html, /Change your password/, 'and not on somebody else’s');
    assert.doesNotMatch(hers.html, /id="current-password"/);
  });

  it('comes back to your own page, and redraws a refusal there (TASK-97 AC #4)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = idOf(cms.config.dataDir, 'ada');
    const { token } = await editScreen(agent, ada);

    const refused = await agent.post('/admin/users/password', {
      csrf_token: token,
      current_password: 'not the current one',
      new_password: 'a brand new password',
      new_password_confirmation: 'a brand new password',
    });

    assert.equal(refused.status, 400);
    const html = await refused.text();
    assert.match(html, /<title>Edit ada/, 'the refusal is redrawn on the edit page');
    assert.match(html, /not your current password/);

    const changed = await agent.post('/admin/users/password', {
      csrf_token: token,
      current_password: FIRST_ADMIN.password,
      new_password: 'a brand new password',
      new_password_confirmation: 'a brand new password',
    });

    assert.equal(changed.status, 303);
    assert.equal(changed.headers.get('location'), `/admin/users/${String(ada)}`);
    assert.match((await editScreen(agent, ada)).html, /Your password was changed/);
  });

  it('signs out every other session and keeps this one (AC #2)', async () => {
    const cms = await box.site();
    const here = await signedIn(cms);
    const elsewhere = await signIn(cms);

    assert.equal((await elsewhere.get('/admin')).status, 200, 'the second browser was signed in');

    const { token } = await usersScreen(here);
    const response = await here.post('/admin/users/password', {
      csrf_token: token,
      current_password: FIRST_ADMIN.password,
      new_password: 'a brand new password',
      new_password_confirmation: 'a brand new password',
    });

    assert.equal(response.status, 303);
    assert.equal((await here.get('/admin')).status, 200, 'the browser that changed it stays in');

    const other = await elsewhere.get('/admin');
    assert.equal(other.status, 302);
    assert.equal(other.headers.get('location'), '/admin/login');
  });

  it('replaces the password, so only the new one logs in', async () => {
    const cms = await box.site();
    const here = await signedIn(cms);
    const { token } = await usersScreen(here);

    await here.post('/admin/users/password', {
      csrf_token: token,
      current_password: FIRST_ADMIN.password,
      new_password: 'a brand new password',
      new_password_confirmation: 'a brand new password',
    });

    const withNew = await signIn(cms, { username: 'ada', password: 'a brand new password' });
    assert.match(await (await withNew.get('/admin')).text(), /Signed in as ada/);

    const stale = browser(cms);
    const loginToken = csrfField(await (await stale.get('/admin/login')).text());
    assert.ok(loginToken !== undefined);
    const refused = await stale.post('/admin/login', {
      csrf_token: loginToken,
      username: 'ada',
      password: FIRST_ADMIN.password,
    });
    assert.equal(refused.status, 401, 'the old password stopped working');
  });
});

describe('a bad password form', () => {
  it('refuses a wrong current password with a 400 and changes nothing', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { token } = await usersScreen(agent);

    const response = await agent.post('/admin/users/password', {
      csrf_token: token,
      current_password: 'not the current one',
      new_password: 'a brand new password',
      new_password_confirmation: 'a brand new password',
    });

    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /not your current password/);
    assert.doesNotMatch(html, /a brand new password/, 'no password is echoed back into the HTML');
    assert.ok(
      verifyUserPassword(cms.config.dataDir, 'ada', FIRST_ADMIN.password) !== undefined,
      'the old password still works',
    );
  });

  it('refuses a confirmation that does not match, and a short new password', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { token } = await usersScreen(agent);

    const mismatch = await agent.post('/admin/users/password', {
      csrf_token: token,
      current_password: FIRST_ADMIN.password,
      new_password: 'a brand new password',
      new_password_confirmation: 'a different new password',
    });
    assert.equal(mismatch.status, 400);
    assert.match(await mismatch.text(), /do not match/);

    const short = await agent.post('/admin/users/password', {
      csrf_token: token,
      current_password: FIRST_ADMIN.password,
      new_password: 'short',
      new_password_confirmation: 'short',
    });
    assert.equal(short.status, 400);
    assert.match(await short.text(), /A password is at least 8 characters/);

    assert.ok(
      verifyUserPassword(cms.config.dataDir, 'ada', FIRST_ADMIN.password) !== undefined,
      'neither refusal changed anything',
    );
  });
});

describe('deleting a user', () => {
  it('is on the edit page, and says why where the account cannot go (TASK-97 AC #5)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = idOf(cms.config.dataDir, 'ada');

    // The only user: there is no button, and the page says what is in the way.
    const alone = await editScreen(agent, ada);
    assert.match(alone.html, /<h2>Delete<\/h2>/);
    assert.match(alone.html, /only user/, 'the refusal is on the page');
    assert.doesNotMatch(alone.html, /<button type="submit">Delete ada<\/button>/);

    const grace = (
      await createUser({
        dataDir: cms.config.dataDir,
        username: 'grace',
        password: 'a password of her own',
      })
    ).id;

    // Still not your own account, even now that somebody else is left.
    const mine = await editScreen(agent, ada);
    assert.match(mine.html, /own account/, 'and so is this one');
    assert.doesNotMatch(mine.html, /<button type="submit">Delete ada<\/button>/);

    // Hers can go, so her page offers it.
    const hers = await editScreen(agent, grace);
    assert.match(hers.html, /<button type="submit">Delete grace<\/button>/);

    const response = await agent.post('/admin/users/delete', {
      csrf_token: hers.token,
      user_id: String(grace),
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/users', 'and lands on the list');
    assert.equal(findUser(cms.config.dataDir, 'grace'), undefined);
    assert.equal((await agent.get(`/admin/users/${String(grace)}`)).status, 404);
  });

  it('refuses to delete the last remaining user, and says why (AC #3)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { html, token } = await usersScreen(agent);
    const ada = findUser(cms.config.dataDir, 'ada');
    assert.ok(ada !== undefined);
    assert.doesNotMatch(html, /<button type="submit">Delete<\/button>/, 'no button is offered');

    const response = await agent.post('/admin/users/delete', {
      csrf_token: token,
      user_id: String(ada.id),
    });

    assert.equal(response.status, 303);
    assert.equal(countUsers(cms.config.dataDir), 1, 'nobody was deleted');
    assert.match(
      await (await agent.get('/admin/users')).text(),
      /only user/,
      'the refusal says the site would be left with nobody',
    );
  });

  it('deletes another user and takes their sessions with them', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const grace = await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'a password of her own',
    });
    const hers = await signIn(cms, { username: 'grace', password: 'a password of her own' });
    const { html, token } = await usersScreen(agent);
    assert.match(html, /<button type="submit">Delete<\/button>/, 'her row has a button');

    const response = await agent.post('/admin/users/delete', {
      csrf_token: token,
      user_id: String(grace.id),
    });

    assert.equal(response.status, 303);
    assert.equal(findUser(cms.config.dataDir, 'grace'), undefined);
    assert.equal((await hers.get('/admin')).status, 302, 'her session went with her');

    const after = await (await agent.get('/admin/users')).text();
    assert.match(after, /Deleted grace\./, 'the screen says what happened');
    assert.doesNotMatch(after, /<td>grace/, 'and she is no longer in the table');
  });

  it('refuses to delete you, even when somebody else is left', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    await createUser({
      dataDir: cms.config.dataDir,
      username: 'grace',
      password: 'a password of her own',
    });
    const ada = findUser(cms.config.dataDir, 'ada');
    assert.ok(ada !== undefined);
    const { token } = await usersScreen(agent);

    const response = await agent.post('/admin/users/delete', {
      csrf_token: token,
      user_id: String(ada.id),
    });

    assert.equal(response.status, 303);
    assert.equal(findUser(cms.config.dataDir, 'ada')?.id, ada.id, 'ada is still there');
    assert.match(await (await agent.get('/admin/users')).text(), /own account/);
  });
});
