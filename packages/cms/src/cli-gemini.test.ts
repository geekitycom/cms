import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, runCli, temporaryDir } from './__testing__/cli.ts';
import { ensureGeminiCertificate } from './gemini/certificate.ts';

after(cleanupTemporaryDirs);

const NOW = new Date('2026-10-23T12:00:00Z');

async function siteWithCertificate(
  host: string,
): Promise<{ directory: string; fingerprint: string }> {
  const directory = await temporaryDir('geekity-gemini-cli-');
  const made = await ensureGeminiCertificate(
    { dataDir: path.join(directory, 'data'), geminiCert: undefined, geminiKey: undefined },
    host,
    NOW,
  );
  assert.ok(made.ok, made.ok ? '' : made.problem);
  return { directory, fingerprint: made.certificate.fingerprint256 };
}

describe('geekity gemini cert', () => {
  it('prints the subject, the expiry and the SHA-256 fingerprint', async () => {
    const { directory, fingerprint } = await siteWithCertificate('shll.me');

    const run = await runCli(['gemini', 'cert'], directory, undefined, {
      GEEKITY_BASE_URL: 'https://shll.me',
    });

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /Subject: CN=shll\.me/);
    assert.match(run.stdout, /Expires: 2076-10-23/);
    assert.ok(run.stdout.includes(`SHA-256 fingerprint: ${fingerprint}`), run.stdout);
    assert.doesNotMatch(run.stdout, /new-cert/);
  });

  it('says when the base URL host is not the one the certificate names', async () => {
    const { directory } = await siteWithCertificate('shll.me');

    const run = await runCli(['gemini', 'cert'], directory, undefined, {
      GEEKITY_BASE_URL: 'https://andrewshell.org',
    });

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /andrewshell\.org/);
    assert.match(run.stdout, /geekity gemini new-cert/);
  });

  it('says there is none yet, and makes none', async () => {
    const directory = await temporaryDir('geekity-gemini-cli-');

    const run = await runCli(['gemini', 'cert'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /no Gemini certificate yet/i);
  });
});

describe('geekity gemini new-cert', () => {
  it('replaces the certificate with one for the base URL host', async () => {
    const { directory, fingerprint } = await siteWithCertificate('shll.me');

    const run = await runCli(['gemini', 'new-cert'], directory, undefined, {
      GEEKITY_BASE_URL: 'https://andrewshell.org',
    });

    assert.equal(run.code, 0, run.stderr);
    const x509 = new X509Certificate(
      await readFile(path.join(directory, 'data', 'gemini', 'cert.pem'), 'utf8'),
    );
    assert.equal(x509.subject, 'CN=andrewshell.org');
    assert.notEqual(x509.fingerprint256, fingerprint);
    assert.ok(run.stdout.includes(x509.fingerprint256), run.stdout);
    assert.match(run.stdout, /warn/i);
  });

  it('refuses to replace an operator certificate', async () => {
    const { directory } = await siteWithCertificate('shll.me');

    const run = await runCli(['gemini', 'new-cert'], directory, undefined, {
      GEEKITY_GEMINI_CERT: path.join(directory, 'data', 'gemini', 'cert.pem'),
      GEEKITY_GEMINI_KEY: path.join(directory, 'data', 'gemini', 'key.pem'),
    });

    assert.equal(run.code, 1);
    assert.match(run.stderr, /GEEKITY_GEMINI_CERT/);
  });

  it('refuses an unknown action', async () => {
    const directory = await temporaryDir('geekity-gemini-cli-');

    const run = await runCli(['gemini', 'sideways'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /cert or new-cert/);
  });
});
