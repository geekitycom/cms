import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { countUsers, createUser, findUser, verifyUserPassword } from './accounts.ts';
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

describe('adding a user', () => {
  it('creates somebody who can then log in (AC #1)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { token } = await usersScreen(agent);

    const response = await agent.post('/admin/users', {
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

    await agent.post('/admin/users', {
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

    await agent.post('/admin/users', {
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

describe('a bad add form', () => {
  it('comes back with a 400, what was typed, and nobody created', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const { token } = await usersScreen(agent);

    const response = await agent.post('/admin/users', {
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

    const response = await agent.post('/admin/users', {
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

    const response = await agent.post('/admin/users', {
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
