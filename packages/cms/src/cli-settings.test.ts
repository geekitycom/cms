import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, exists, readJson, runCli, temporaryDir } from './__testing__/cli.ts';
import { readDevModeRecord } from './settings/dev-mode.ts';

after(cleanupTemporaryDirs);

function lineOf(stdout: string, setting: string): string {
  const line = stdout.split('\n').find((each) => each.startsWith(`${setting} `));
  assert.ok(line !== undefined, `${setting} is listed in:\n${stdout}`);
  return line.replace(/\s+/g, ' ').trim();
}

describe('geekity settings', () => {
  it('moves plugin settings out of site.json with migrate-plugins, logging each plugin moved', async () => {
    const directory = await temporaryDir('geekity-settings-cli-');
    await mkdir(path.join(directory, 'content', '_data'), { recursive: true });
    const siteJson = path.join(directory, 'content', '_data', 'site.json');
    await writeFile(
      siteJson,
      JSON.stringify({
        title: 'Kept',
        plugins: {
          '@geekity/plugin-llm': { enabled: true, default_model: 'openai/gpt-4o-mini' },
          '@acme/plugin-off': { enabled: false },
        },
      }),
    );

    const moved = await runCli(['settings', 'migrate-plugins'], directory);
    assert.equal(moved.code, 0, moved.stderr);
    assert.equal(
      moved.stdout,
      'Moved the settings of @geekity/plugin-llm from content/_data/site.json to data/plugins/@geekity/plugin-llm/settings.json.\n',
    );
    assert.deepEqual(await readJson(siteJson), {
      title: 'Kept',
      plugins: {
        '@geekity/plugin-llm': { enabled: true },
        '@acme/plugin-off': { enabled: false },
      },
    });
    assert.deepEqual(
      await readJson(
        path.join(directory, 'data', 'plugins', '@geekity', 'plugin-llm', 'settings.json'),
      ),
      { default_model: 'openai/gpt-4o-mini' },
    );

    const again = await runCli(['settings', 'migrate-plugins'], directory);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(again.stdout, 'No plugin settings are left in content/_data/site.json.\n');
  });

  it('lists every core setting with its value, source and description', async () => {
    const directory = await temporaryDir('geekity-settings-cli-');

    const listed = await runCli(['settings', 'list'], directory);

    assert.equal(listed.code, 0, listed.stderr);
    assert.equal(
      lineOf(listed.stdout, 'maintenance.on'),
      'maintenance.on false default Answer 503 to the public site, feeds and inboxes.',
    );
    assert.match(lineOf(listed.stdout, 'maintenance.until'), /^maintenance\.until default When/);
    assert.match(
      lineOf(listed.stdout, 'dev_mode.on'),
      /^dev_mode\.on false default, not overridable Hold/,
    );

    const one = await runCli(['settings', 'list', 'dev_mode'], directory);
    assert.equal(one.code, 0, one.stderr);
    assert.doesNotMatch(one.stdout, /maintenance/);
  });

  it('prints the source and the stored value for an overridden setting', async () => {
    const directory = await temporaryDir('geekity-settings-cli-');
    await mkdir(path.join(directory, 'data'));
    await writeFile(path.join(directory, 'data', 'maintenance.json'), '{ "on": false }\n');
    const env = { GEEKITY_MAINTENANCE: 'true' };

    const listed = await runCli(['settings', 'list'], directory, undefined, env);
    assert.match(
      lineOf(listed.stdout, 'maintenance.on'),
      /^maintenance\.on true env GEEKITY_MAINTENANCE \(file: false\) Answer 503/,
    );

    const got = await runCli(['settings', 'get', 'maintenance.on'], directory, undefined, env);
    assert.equal(got.code, 0, got.stderr);
    assert.equal(got.stdout, 'true\noverridden by env GEEKITY_MAINTENANCE; the file holds false\n');

    const refused = await runCli(
      ['settings', 'set', 'maintenance.on', 'false'],
      directory,
      undefined,
      env,
    );
    assert.equal(refused.code, 1);
    assert.match(
      refused.stderr,
      /maintenance\.on is set by GEEKITY_MAINTENANCE and cannot be changed here/,
    );
    assert.deepEqual(await readJson(path.join(directory, 'data', 'maintenance.json')), {
      on: false,
    });
  });

  it('sets, gets and unsets a value, printing the new line', async () => {
    const directory = await temporaryDir('geekity-settings-cli-');

    const set = await runCli(
      ['settings', 'set', 'maintenance.until', '2026-10-14T09:00:00Z'],
      directory,
    );
    assert.equal(set.code, 0, set.stderr);
    assert.match(
      lineOf(set.stdout, 'maintenance.until'),
      /^maintenance\.until 2026-10-14T09:00:00\.000Z file When/,
    );

    const got = await runCli(['settings', 'get', 'maintenance.until'], directory);
    assert.equal(got.stdout, '2026-10-14T09:00:00.000Z\n');

    const unset = await runCli(['settings', 'set', 'maintenance.until', '--unset'], directory);
    assert.equal(unset.code, 0, unset.stderr);
    assert.deepEqual(await readJson(path.join(directory, 'data', 'maintenance.json')), {
      on: false,
      until: '',
    });
    assert.match(
      (await runCli(['maintenance', 'status'], directory)).stdout,
      /Maintenance mode is off/,
    );
  });

  it('runs the change hook, so dev mode turned on from settings is in the record', async () => {
    const directory = await temporaryDir('geekity-settings-cli-');

    const set = await runCli(['settings', 'set', 'dev_mode.on', 'true'], directory);

    assert.equal(set.code, 0, set.stderr);
    assert.deepEqual(
      readDevModeRecord(path.join(directory, 'data')).map((entry) => [
        entry.type,
        'by' in entry ? entry.by : undefined,
      ]),
      [['on', 'command']],
    );
  });

  it('prints (set) or (not set) for each mail secret and never its value', async () => {
    const directory = await temporaryDir('geekity-settings-cli-');
    await mkdir(path.join(directory, 'data'));
    await writeFile(
      path.join(directory, 'data', 'mail.json'),
      JSON.stringify({ brevo: { apiKey: 'xkeysib-stored-secret' } }),
    );
    const env = { GEEKITY_MAIL__SMTP_PASSWORD: 'env-held-secret' };

    const listed = await runCli(['settings', 'list', 'mail'], directory, undefined, env);

    assert.equal(listed.code, 0, listed.stderr);
    assert.match(lineOf(listed.stdout, 'mail.brevo_api_key'), /^mail\.brevo_api_key \(set\) file /);
    assert.match(
      lineOf(listed.stdout, 'mail.smtp_password'),
      /^mail\.smtp_password \(set\) env GEEKITY_MAIL__SMTP_PASSWORD /,
    );
    assert.match(lineOf(listed.stdout, 'mail.smtp_host'), /^mail\.smtp_host default /);
    assert.doesNotMatch(listed.stdout, /xkeysib-stored-secret|env-held-secret/);
    assert.doesNotMatch(listed.stdout, /maintenance|akismet/);

    const emptied = await runCli(['settings', 'set', 'mail.brevo_api_key', '--unset'], directory);
    assert.equal(emptied.code, 0, emptied.stderr);
    assert.match(lineOf(emptied.stdout, 'mail.brevo_api_key'), /^mail\.brevo_api_key \(not set\) /);

    const got = await runCli(['settings', 'get', 'mail.smtp_password'], directory, undefined, env);
    assert.doesNotMatch(got.stdout, /env-held-secret/);
  });

  it('refuses a value that does not parse, an unknown setting and a missing verb, writing nothing', async () => {
    const directory = await temporaryDir('geekity-settings-cli-');

    const bad = await runCli(['settings', 'set', 'maintenance.on', 'maybe'], directory);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /maintenance\.on must be true or false/);
    assert.ok(!(await exists(path.join(directory, 'data', 'maintenance.json'))));

    const unknown = await runCli(['settings', 'get', 'maintenance.sideways'], directory);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /There is no setting maintenance\.sideways/);

    assert.equal((await runCli(['settings'], directory)).code, 1);
  });
});
