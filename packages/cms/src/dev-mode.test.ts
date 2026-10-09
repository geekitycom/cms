import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  devModeOn,
  enterDevMode,
  holdOutbound,
  leaveDevMode,
  readDevModeRecord,
} from './dev-mode.ts';

const dirs: string[] = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

async function dataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-dev-mode-'));
  dirs.push(dir);
  return dir;
}

describe('dev mode', () => {
  it('is off on a site that never entered it, and holds nothing', async () => {
    const config = { dataDir: await dataDir(), devMode: false };

    assert.equal(devModeOn(config), false);
    assert.equal(
      holdOutbound(config, { kind: 'mail', what: 'Hello', to: ['ada@example.com'] }),
      false,
    );
    assert.deepEqual(readDevModeRecord(config.dataDir), []);
  });

  it('holds and records every outbound effect while on', async () => {
    const config = { dataDir: await dataDir(), devMode: false };
    enterDevMode(config.dataDir, 'command', new Date('2026-10-09T10:00:00Z'));

    assert.equal(devModeOn(config), true);
    assert.equal(
      holdOutbound(config, {
        kind: 'activitypub',
        what: 'Create https://blog.example/a/',
        to: ['https://remote.example/inbox'],
      }),
      true,
    );

    const record = readDevModeRecord(config.dataDir);
    assert.deepEqual(
      record.map((entry) => entry.type),
      ['on', 'held'],
    );
    assert.deepEqual(record[1], {
      type: 'held',
      at: record[1]?.at,
      kind: 'activitypub',
      what: 'Create https://blog.example/a/',
      to: ['https://remote.example/inbox'],
    });
  });

  it('is entered once however often a boot asks for it', async () => {
    const dir = await dataDir();

    assert.equal(enterDevMode(dir, 'config'), true);
    assert.equal(enterDevMode(dir, 'config'), false);

    assert.deepEqual(
      readDevModeRecord(dir).map((entry) => entry.type),
      ['on'],
    );
  });

  it('stays on when the config stops asking for it, until it is left', async () => {
    const dir = await dataDir();
    enterDevMode(dir, 'config');

    assert.equal(devModeOn({ dataDir: dir, devMode: false }), true);

    assert.equal(leaveDevMode(dir), true);
    assert.equal(devModeOn({ dataDir: dir, devMode: false }), false);
    assert.equal(leaveDevMode(dir), false, 'leaving twice records nothing more');
    assert.deepEqual(
      readDevModeRecord(dir).map((entry) => entry.type),
      ['on', 'off'],
    );
  });

  it('is on while the config asks for it, file or not', async () => {
    assert.equal(devModeOn({ dataDir: await dataDir(), devMode: true }), true);
  });

  it('counts a file it cannot read as on', async () => {
    const dir = await dataDir();
    await writeFile(path.join(dir, 'dev-mode.json'), 'not json', 'utf8');

    assert.equal(devModeOn({ dataDir: dir, devMode: false }), true);
  });

  it('counts a file it is not allowed to read as on', async () => {
    const dir = await dataDir();
    enterDevMode(dir, 'command');
    await chmod(path.join(dir, 'dev-mode.json'), 0o000);

    assert.equal(devModeOn({ dataDir: dir, devMode: false }), true);
  });

  it('skips a record line it cannot read rather than losing the rest', async () => {
    const dir = await dataDir();
    enterDevMode(dir, 'command');
    await writeFile(path.join(dir, 'dev-mode.jsonl'), 'garbage\n', { flag: 'a' });
    holdOutbound({ dataDir: dir, devMode: false }, { kind: 'indexnow', what: 'x', to: ['y'] });

    assert.deepEqual(
      readDevModeRecord(dir).map((entry) => entry.type),
      ['on', 'held'],
    );
  });
});
