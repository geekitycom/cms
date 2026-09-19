import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, exists, runCli, temporaryDir } from './__testing__/cli.ts';
import { createCms, listUsers, MINIMUM_PASSWORD_LENGTH } from './index.ts';

after(cleanupTemporaryDirs);

describe('geekity user add', () => {
  /** The usernames in a site's `data/users.json`, read as the CMS reads it. */
  function usernames(directory: string): string[] {
    return listUsers(path.join(directory, 'data')).map((user) => user.username);
  }

  it('creates an admin and says which one', async () => {
    const directory = await temporaryDir('geekity-user-add-');

    const run = await runCli(['user', 'add', 'ada', '--password', 'hunter22'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /ada/);
    assert.deepEqual(usernames(directory), ['ada']);
  });

  it('creates a user who can then log in through /admin/login', async () => {
    const directory = await temporaryDir('geekity-user-login-');
    const run = await runCli(['user', 'add', 'ada', '--password', 'hunter22'], directory);
    assert.equal(run.code, 0, run.stderr);

    const cms = createCms({
      contentDir: path.join(directory, 'content'),
      dataDir: path.join(directory, 'data'),
      watch: false,
    });
    try {
      // A user exists, so setup is closed and the login form is the way in.
      const form = await cms.app.request('/admin/login');
      assert.equal(form.status, 200);
      const html = await form.text();
      const token = /name="csrf_token"\s+value="([^"]+)"/.exec(html)?.[1];
      assert.ok(token, 'expected a CSRF token on the login form');
      const cookie = (form.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '';

      const response = await cms.app.request('/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: new URLSearchParams({
          username: 'ada',
          password: 'hunter22',
          csrf_token: token,
        }).toString(),
      });

      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/admin');
    } finally {
      await cms.close();
    }
  });

  it('stores --email on the user it creates (AC #1)', async () => {
    const directory = await temporaryDir('geekity-user-email-');

    const run = await runCli(
      ['user', 'add', 'ada', '--password', 'hunter22', '--email', 'ada@example.com'],
      directory,
    );

    assert.equal(run.code, 0, run.stderr);
    assert.equal(listUsers(path.join(directory, 'data'))[0]?.email, 'ada@example.com');
  });

  it('refuses an --email that is not an address and adds nobody', async () => {
    const directory = await temporaryDir('geekity-user-bad-email-');

    const run = await runCli(
      ['user', 'add', 'ada', '--password', 'hunter22', '--email', 'not-an-address'],
      directory,
    );

    assert.equal(run.code, 1);
    assert.match(run.stderr, /email address/i);
    assert.deepEqual(usernames(directory), []);
  });

  it('reads the password from stdin when the flag is absent', async () => {
    const directory = await temporaryDir('geekity-user-stdin-');

    const run = await runCli(['user', 'add', 'ada'], directory, 'hunter22\n');

    assert.equal(run.code, 0, run.stderr);
    assert.deepEqual(usernames(directory), ['ada']);
    // Nothing is prompted off a terminal, and the password is never echoed.
    assert.doesNotMatch(run.stdout + run.stderr, /hunter22/);
  });

  it('refuses a name that is already taken and adds nobody', async () => {
    const directory = await temporaryDir('geekity-user-dup-');
    await runCli(['user', 'add', 'ada', '--password', 'hunter22'], directory);

    const run = await runCli(['user', 'add', 'ada', '--password', 'different1'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /already exists/i);
    assert.deepEqual(usernames(directory), ['ada']);
  });

  it('refuses a username the setup form would refuse', async () => {
    const directory = await temporaryDir('geekity-user-bad-');

    const run = await runCli(['user', 'add', 'ada lovelace', '--password', 'hunter22'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /username/i);
    assert.deepEqual(usernames(directory), []);
  });

  it('refuses a password shorter than the setup form would accept', async () => {
    const directory = await temporaryDir('geekity-user-short-');

    const run = await runCli(['user', 'add', 'ada', '--password', 'short'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, new RegExp(String(MINIMUM_PASSWORD_LENGTH)));
    assert.deepEqual(usernames(directory), []);
  });

  it('needs a username', async () => {
    const directory = await temporaryDir('geekity-user-bare-');

    const run = await runCli(['user', 'add'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /geekity user add <username>/);
  });

  it('names the subcommand it has when given one it does not', async () => {
    const directory = await temporaryDir('geekity-user-sub-');

    const run = await runCli(['user', 'remove', 'ada'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /add/);
  });

  it('puts the user where the config says the data lives', async () => {
    const directory = await temporaryDir('geekity-user-config-');
    await fs.writeFile(
      path.join(directory, 'site.config.js'),
      "export default { dataDir: 'elsewhere' };\n",
      'utf8',
    );

    const run = await runCli(
      ['user', 'add', 'ada', '--password', 'hunter22', '--config', 'site.config.js'],
      directory,
    );

    assert.equal(run.code, 0, run.stderr);
    assert.ok(await exists(path.join(directory, 'elsewhere', 'geekity.db')));
    assert.ok(!(await exists(path.join(directory, 'data'))));
  });
});
