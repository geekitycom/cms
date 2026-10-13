import assert from 'node:assert/strict';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, readJson, runCli, temporaryDir } from './__testing__/cli.ts';
import { readDevModeRecord } from './settings/dev-mode.ts';

after(cleanupTemporaryDirs);

describe('geekity dev-mode', () => {
  it('turns dev mode on, reports it, and takes the site live with a logged entry', async () => {
    const directory = await temporaryDir('geekity-dev-mode-cli-');
    const dataDir = path.join(directory, 'data');

    const on = await runCli(['dev-mode', 'on'], directory);
    assert.equal(on.code, 0, on.stderr);
    assert.deepEqual(await readJson(path.join(dataDir, 'dev-mode.json')), { on: true });

    const status = await runCli(['dev-mode', 'status'], directory);
    assert.match(status.stdout, /Dev mode is on/);

    const off = await runCli(['dev-mode', 'off'], directory);
    assert.equal(off.code, 0, off.stderr);
    assert.match(off.stdout, /live/);
    assert.deepEqual(await readJson(path.join(dataDir, 'dev-mode.json')), { on: false });
    assert.deepEqual(
      readDevModeRecord(dataDir).map((entry) => [entry.type, 'by' in entry ? entry.by : undefined]),
      [
        ['on', 'command'],
        ['off', 'command'],
      ],
      'going live is in the record',
    );

    const statusOff = await runCli(['dev-mode', 'status'], directory);
    assert.match(statusOff.stdout, /Dev mode is off/);
  });

  it('refuses to go live while GEEKITY_DEV_MODE still asks for dev mode', async () => {
    const directory = await temporaryDir('geekity-dev-mode-cli-');
    await runCli(['dev-mode', 'on'], directory);

    const off = await runCli(['dev-mode', 'off'], directory, undefined, {
      GEEKITY_DEV_MODE: 'true',
    });

    assert.equal(off.code, 1);
    assert.match(off.stderr, /GEEKITY_DEV_MODE/);
    assert.deepEqual(
      await readJson(path.join(directory, 'data', 'dev-mode.json')),
      { on: true },
      'still on',
    );
  });

  it('refuses a missing or unknown action', async () => {
    const directory = await temporaryDir('geekity-dev-mode-cli-');

    assert.equal((await runCli(['dev-mode'], directory)).code, 1);
    assert.equal((await runCli(['dev-mode', 'sideways'], directory)).code, 1);
  });
});
