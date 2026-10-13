import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, exists, readJson, runCli, temporaryDir } from './__testing__/cli.ts';

after(cleanupTemporaryDirs);

describe('geekity maintenance', () => {
  it('turns maintenance on and off in data/maintenance.json', async () => {
    const directory = await temporaryDir('geekity-maintenance-cli-');
    const marker = path.join(directory, 'data', 'maintenance.json');

    const on = await runCli(['maintenance', 'on'], directory);
    assert.equal(on.code, 0, on.stderr);
    assert.match(on.stdout, /on/i);
    assert.deepEqual(await readJson(marker), { on: true, until: '' });

    const status = await runCli(['maintenance', 'status'], directory);
    assert.equal(status.code, 0, status.stderr);
    assert.match(status.stdout, /Maintenance mode is on/);

    const off = await runCli(['maintenance', 'off'], directory);
    assert.equal(off.code, 0, off.stderr);
    assert.deepEqual(await readJson(marker), { on: false, until: '' });

    const again = await runCli(['maintenance', 'off'], directory);
    assert.equal(again.code, 0, 'turning it off twice is not an error');

    const statusOff = await runCli(['maintenance', 'status'], directory);
    assert.match(statusOff.stdout, /Maintenance mode is off/);
  });

  it('records when the site expects to be back', async () => {
    const directory = await temporaryDir('geekity-maintenance-cli-');

    const on = await runCli(['maintenance', 'on', '--until', '2026-09-28T14:00:00Z'], directory);

    assert.equal(on.code, 0, on.stderr);
    assert.deepEqual(await readJson(path.join(directory, 'data', 'maintenance.json')), {
      on: true,
      until: '2026-09-28T14:00:00.000Z',
    });
    const status = await runCli(['maintenance', 'status'], directory);
    assert.match(status.stdout, /Mon, 28 Sep 2026 14:00:00 GMT/);
  });

  it('refuses an --until that is not a time', async () => {
    const directory = await temporaryDir('geekity-maintenance-cli-');

    const on = await runCli(['maintenance', 'on', '--until', 'soonish'], directory);

    assert.equal(on.code, 1);
    assert.match(on.stderr, /--until/);
    assert.ok(!(await exists(path.join(directory, 'data', 'maintenance.json'))));
  });

  it('refuses a missing or unknown action', async () => {
    const directory = await temporaryDir('geekity-maintenance-cli-');

    assert.equal((await runCli(['maintenance'], directory)).code, 1);
    assert.equal((await runCli(['maintenance', 'sideways'], directory)).code, 1);
  });

  it('says when the environment forces it on', async () => {
    const directory = await temporaryDir('geekity-maintenance-cli-');
    process.env['GEEKITY_MAINTENANCE'] = 'on';
    try {
      const status = await runCli(['maintenance', 'status'], directory);
      assert.match(status.stdout, /GEEKITY_MAINTENANCE/);
    } finally {
      delete process.env['GEEKITY_MAINTENANCE'];
    }
  });

  it('refuses to turn it off while the environment forces it on, and leaves the file alone', async () => {
    const directory = await temporaryDir('geekity-maintenance-cli-');
    await runCli(['maintenance', 'on'], directory);

    const off = await runCli(['maintenance', 'off'], directory, undefined, {
      GEEKITY_MAINTENANCE: 'on',
    });

    assert.equal(off.code, 1);
    assert.match(off.stderr, /GEEKITY_MAINTENANCE or the maintenance setting keeps it on/);
    assert.deepEqual(await readJson(path.join(directory, 'data', 'maintenance.json')), {
      on: true,
      until: '',
    });
  });

  it('reads a file an older CLI wrote, whose presence meant on', async () => {
    const directory = await temporaryDir('geekity-maintenance-cli-');
    await mkdir(path.join(directory, 'data'));
    await writeFile(path.join(directory, 'data', 'maintenance.json'), '{}\n');

    const status = await runCli(['maintenance', 'status'], directory);

    assert.match(status.stdout, /Maintenance mode is on/);
  });
});
