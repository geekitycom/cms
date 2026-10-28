import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { resolveConfig } from '../config.ts';
import { AKISMET } from './akismet.ts';
import { HCAPTCHA } from './hcaptcha.ts';
import { MAIL } from './mail.ts';
import { createSettingsRegistry } from './registry.ts';

const dirs: string[] = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

async function site(
  env: Record<string, string> = {},
): Promise<{ registry: ReturnType<typeof createSettingsRegistry>; dataDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'geekity-credentials-'));
  dirs.push(root);
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir);
  const config = resolveConfig(
    { contentDir: path.join(root, 'content'), dataDir },
    { env, cwd: root },
  );
  return { registry: createSettingsRegistry({ config, env }), dataDir };
}

const changes = (entries: Record<string, unknown>) => new Map(Object.entries(entries));

async function fileOf(dataDir: string, name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dataDir, name), 'utf8'));
}

async function modeOf(dataDir: string, name: string): Promise<number> {
  return (await stat(path.join(dataDir, name))).mode & 0o777;
}

const NO_MAIL = {
  brevo_api_key: '',
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: '',
  smtp_password: '',
};

describe('the mail namespace', () => {
  it('is no mail at all until something is written', async () => {
    const { registry } = await site();
    assert.deepEqual(await registry.values(MAIL), NO_MAIL);
  });

  it('reads the nested file the previous version wrote, and rewrites it flat at 0600', async () => {
    const { registry, dataDir } = await site();
    await writeFile(
      path.join(dataDir, 'mail.json'),
      JSON.stringify({
        brevo: { apiKey: ' xkeysib-secret ' },
        smtp: { host: 'smtp.example.com', secure: true, user: 'postmaster', password: 'hunter2' },
      }),
    );

    assert.deepEqual(await registry.values(MAIL), {
      brevo_api_key: 'xkeysib-secret',
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      smtp_secure: true,
      smtp_user: 'postmaster',
      smtp_password: 'hunter2',
    });

    assert.deepEqual(await registry.set('mail', changes({ smtp_user: 'webmaster' }), 'admin'), {
      ok: true,
    });
    assert.deepEqual(await fileOf(dataDir, 'mail.json'), {
      brevo_api_key: 'xkeysib-secret',
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      smtp_secure: true,
      smtp_user: 'webmaster',
      smtp_password: 'hunter2',
    });
    assert.equal(await modeOf(dataDir, 'mail.json'), 0o600);
  });

  it('drops a half-written nested entry rather than believing it', async () => {
    const { registry, dataDir } = await site();
    await writeFile(
      path.join(dataDir, 'mail.json'),
      JSON.stringify({ brevo: { apiKey: '' }, smtp: { host: '', port: 2525 } }),
    );
    assert.deepEqual(await registry.values(MAIL), NO_MAIL);
  });

  it('is a site with no mail rather than one that will not boot when the file will not parse', async () => {
    const { registry, dataDir } = await site();
    await writeFile(path.join(dataDir, 'mail.json'), '{ not json');
    assert.deepEqual(await registry.values(MAIL), NO_MAIL);
  });

  it('puts an SMTP password from the environment in effect and refuses to store one over it', async () => {
    const { registry, dataDir } = await site({ GEEKITY_MAIL__SMTP_PASSWORD: 'from-the-env' });

    const password = await registry.resolve(MAIL.smtp_password);
    assert.equal(password.value, 'from-the-env');
    assert.deepEqual(password.source, { tier: 'env', variable: 'GEEKITY_MAIL__SMTP_PASSWORD' });

    const refused = await registry.set(
      'mail',
      changes({ smtp_host: 'smtp.example.com', smtp_password: 'typed' }),
      'admin',
    );
    assert.deepEqual(refused, {
      ok: false,
      problems: {
        smtp_password:
          'mail.smtp_password is set by GEEKITY_MAIL__SMTP_PASSWORD and cannot be changed here.',
      },
    });
    await assert.rejects(stat(path.join(dataDir, 'mail.json')), { code: 'ENOENT' });
  });

  it('refuses a port that cannot be one, and the well-known ports with the wrong TLS', async () => {
    const { registry } = await site();

    const outOfRange = await registry.set('mail', changes({ smtp_port: 70000 }), 'admin');
    assert.equal(outOfRange.ok, false);

    const noServerYet = await registry.set(
      'mail',
      changes({ smtp_port: 465, smtp_secure: false }),
      'admin',
    );
    assert.deepEqual(noServerYet, { ok: true }, 'the pairing is only checked once there is a host');

    const implicitWithoutTls = await registry.set(
      'mail',
      changes({ smtp_host: 'smtp.example.com', smtp_port: 465, smtp_secure: false }),
      'admin',
    );
    assert.deepEqual(implicitWithoutTls, {
      ok: false,
      problems: {
        smtp_port: 'mail.smtp_port 465 is TLS from the first byte, so smtp_secure must be true.',
        smtp_secure: 'mail.smtp_port 465 is TLS from the first byte, so smtp_secure must be true.',
      },
    });

    const stored = await registry.set(
      'mail',
      changes({ smtp_host: 'smtp.example.com', smtp_port: 465, smtp_secure: true }),
      'admin',
    );
    assert.deepEqual(stored, { ok: true });

    const secureOnSubmission = await registry.set('mail', changes({ smtp_port: 587 }), 'admin');
    assert.equal(secureOnSubmission.ok, false);
    assert.equal(await registry.get(MAIL.smtp_port), 465);

    assert.deepEqual(await registry.set('mail', changes({ smtp_port: 2525 }), 'admin'), {
      ok: true,
    });
  });
});

describe('the akismet namespace', () => {
  it('reads the file the previous version wrote, and rewrites it flat at 0600', async () => {
    const { registry, dataDir } = await site();
    await writeFile(
      path.join(dataDir, 'akismet.json'),
      JSON.stringify({ key: 'abc123', status: 'valid', checkedAt: '2026-05-01T10:00:00.000Z' }),
    );

    assert.deepEqual(await registry.values(AKISMET), {
      key: 'abc123',
      status: 'valid',
      checked_at: '2026-05-01T10:00:00.000Z',
    });

    await registry.set('akismet', changes({ status: 'invalid' }), 'admin');
    assert.deepEqual(await fileOf(dataDir, 'akismet.json'), {
      key: 'abc123',
      status: 'invalid',
      checked_at: '2026-05-01T10:00:00.000Z',
    });
    assert.equal(await modeOf(dataDir, 'akismet.json'), 0o600);
  });

  it('reads a status it does not know as unchecked', async () => {
    const { registry, dataDir } = await site();
    await writeFile(
      path.join(dataDir, 'akismet.json'),
      JSON.stringify({ key: 'abc123', status: 'maybe' }),
    );
    assert.equal(await registry.get(AKISMET.status), 'unchecked');
  });

  it('puts a key from the environment in effect and refuses to store one over it', async () => {
    const { registry } = await site({ GEEKITY_AKISMET__KEY: 'env-key-9876' });

    assert.deepEqual((await registry.resolve(AKISMET.key)).source, {
      tier: 'env',
      variable: 'GEEKITY_AKISMET__KEY',
    });
    assert.equal(await registry.get(AKISMET.key), 'env-key-9876');
    const refused = await registry.set('akismet', changes({ key: 'typed' }), 'admin');
    assert.equal(refused.ok, false);
  });
});

describe('the hcaptcha namespace', () => {
  it('is no site key and no secret until something is written', async () => {
    const { registry } = await site();
    assert.deepEqual(await registry.values(HCAPTCHA), {
      site_key: '',
      secret: '',
      status: 'unchecked',
      checked_at: '',
    });
  });

  it('keeps the site key and the secret in data/hcaptcha.json at 0600', async () => {
    const { registry, dataDir } = await site();

    await registry.set(
      'hcaptcha',
      changes({ site_key: '10000000-ffff-ffff-ffff-000000000001', secret: '0xsecret' }),
      'admin',
    );

    assert.deepEqual(await fileOf(dataDir, 'hcaptcha.json'), {
      site_key: '10000000-ffff-ffff-ffff-000000000001',
      secret: '0xsecret',
    });
    assert.equal(await modeOf(dataDir, 'hcaptcha.json'), 0o600);
  });

  it('holds the secret as a secret and the site key, which the page prints, as not one', () => {
    assert.equal(HCAPTCHA.secret.declaration.secret, true);
    assert.notEqual(HCAPTCHA.site_key.declaration.secret, true);
  });

  it('puts both values from the environment in effect and refuses to store one over them', async () => {
    const { registry } = await site({
      GEEKITY_HCAPTCHA__SITE_KEY: 'env-site-key',
      GEEKITY_HCAPTCHA__SECRET: 'env-secret',
    });

    assert.deepEqual((await registry.resolve(HCAPTCHA.site_key)).source, {
      tier: 'env',
      variable: 'GEEKITY_HCAPTCHA__SITE_KEY',
    });
    assert.deepEqual((await registry.resolve(HCAPTCHA.secret)).source, {
      tier: 'env',
      variable: 'GEEKITY_HCAPTCHA__SECRET',
    });
    assert.equal(await registry.get(HCAPTCHA.secret), 'env-secret');
    const refused = await registry.set('hcaptcha', changes({ secret: 'typed' }), 'admin');
    assert.equal(refused.ok, false);
  });
});
