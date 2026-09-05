import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  MAIL_CREDENTIALS_FILE,
  mailCredentialsPath,
  readMailCredentials,
  removeMailCredentials,
  writeMailCredentials,
} from './credentials.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dataDir(): Promise<string> {
  const created = await mkdtemp(path.join(tmpdir(), 'geekity-mail-credentials-'));
  dirs.push(created);
  return created;
}

describe('the mail credential file', () => {
  it('is data/mail.json', async () => {
    const dir = await dataDir();
    assert.equal(mailCredentialsPath(dir), path.join(dir, MAIL_CREDENTIALS_FILE));
    assert.equal(MAIL_CREDENTIALS_FILE, 'mail.json');
  });

  it('is nothing at all until something is written', async () => {
    assert.deepEqual(readMailCredentials(await dataDir()), {});
  });

  it('keeps a Brevo key and reads it back', async () => {
    const dir = await dataDir();
    await writeMailCredentials(dir, { brevo: { apiKey: 'xkeysib-secret' } });
    assert.deepEqual(readMailCredentials(dir), { brevo: { apiKey: 'xkeysib-secret' } });
  });

  it('keeps an SMTP connection and reads it back', async () => {
    const dir = await dataDir();
    await writeMailCredentials(dir, {
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'postmaster',
        password: 'hunter2',
      },
    });

    assert.deepEqual(readMailCredentials(dir).smtp, {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'postmaster',
      password: 'hunter2',
    });
  });

  it('is private to the account the site runs as', async () => {
    const dir = await dataDir();
    await writeMailCredentials(dir, { brevo: { apiKey: 'xkeysib-secret' } });
    assert.equal(statSync(mailCredentialsPath(dir)).mode & 0o777, 0o600);
  });

  it('is a site with no mail rather than a site that will not boot when it will not parse', async () => {
    const dir = await dataDir();
    await writeFile(mailCredentialsPath(dir), '{ not json', 'utf8');
    assert.deepEqual(readMailCredentials(dir), {});
  });

  it('drops a half-written entry rather than believing it', async () => {
    const dir = await dataDir();
    await writeFile(
      mailCredentialsPath(dir),
      JSON.stringify({ brevo: { apiKey: '' }, smtp: { host: '', port: 587 } }),
      'utf8',
    );
    assert.deepEqual(readMailCredentials(dir), {});
  });

  it('forgets everything when the credentials are removed', async () => {
    const dir = await dataDir();
    await writeMailCredentials(dir, { brevo: { apiKey: 'xkeysib-secret' } });
    await removeMailCredentials(dir);

    assert.deepEqual(readMailCredentials(dir), {});
    assert.throws(() => readFileSync(mailCredentialsPath(dir), 'utf8'));
  });

  it('is safe to remove when there is nothing to remove', async () => {
    await removeMailCredentials(await dataDir());
  });
});
