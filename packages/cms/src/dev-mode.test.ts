import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { resolveConfig } from './config.ts';
import { holdOutbound } from './dev-mode.ts';
import { DEV_MODE, readDevModeRecord } from './settings/dev-mode.ts';
import { createSettingsRegistry } from './settings/registry.ts';

const dirs: string[] = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const NOW = new Date('2026-10-09T10:00:00Z');

async function site() {
  const root = await mkdtemp(path.join(tmpdir(), 'geekity-dev-mode-'));
  dirs.push(root);
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir);
  const config = resolveConfig(
    { dataDir, contentDir: path.join(root, 'content'), now: () => NOW },
    { env: {} },
  );
  const settings = createSettingsRegistry({ config, env: {} });
  const turnOn = () => settings.set('dev_mode', new Map([['on', true]]), 'cli');
  return { config, settings, dataDir, turnOn };
}

describe('dev mode', () => {
  it('is off on a site that never entered it, and holds nothing', async () => {
    const { config, settings, dataDir } = await site();

    assert.equal(
      await holdOutbound(settings, config, {
        kind: 'mail',
        what: 'Hello',
        to: ['ada@example.com'],
      }),
      false,
    );
    assert.deepEqual(readDevModeRecord(dataDir), []);
  });

  it('holds and records every outbound effect while on', async () => {
    const { config, settings, dataDir, turnOn } = await site();
    await turnOn();

    assert.equal(
      await holdOutbound(settings, config, {
        kind: 'activitypub',
        what: 'Create https://blog.example/a/',
        to: ['https://remote.example/inbox'],
      }),
      true,
    );

    const record = readDevModeRecord(dataDir);
    assert.deepEqual(
      record.map((entry) => entry.type),
      ['on', 'held'],
    );
    assert.deepEqual(record[1], {
      type: 'held',
      at: NOW.toISOString(),
      kind: 'activitypub',
      what: 'Create https://blog.example/a/',
      to: ['https://remote.example/inbox'],
    });
  });

  it('counts a file it cannot parse as on', async () => {
    const { settings, dataDir } = await site();
    await writeFile(path.join(dataDir, 'dev-mode.json'), 'not json', 'utf8');

    assert.equal(await settings.get(DEV_MODE.on), true);
  });

  it('counts a file it is not allowed to read as on', async () => {
    const { settings, dataDir, turnOn } = await site();
    await turnOn();
    await chmod(path.join(dataDir, 'dev-mode.json'), 0o000);

    assert.equal(await settings.get(DEV_MODE.on), true);
  });

  it('skips a record line it cannot read rather than losing the rest', async () => {
    const { config, settings, dataDir, turnOn } = await site();
    await turnOn();
    await writeFile(path.join(dataDir, 'dev-mode.jsonl'), 'garbage\n', { flag: 'a' });
    await holdOutbound(settings, config, { kind: 'indexnow', what: 'x', to: ['y'] });

    assert.deepEqual(
      readDevModeRecord(dataDir).map((entry) => entry.type),
      ['on', 'held'],
    );
  });
});
