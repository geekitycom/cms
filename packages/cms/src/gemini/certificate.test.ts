import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import tls from 'node:tls';

import { GEMINI_CERTIFICATE, GEMINI_KEY, dataPath } from '../files/data-files.ts';
import type { GeminiCertificate, GeminiCertificateConfig } from './certificate.ts';
import {
  ensureGeminiCertificate,
  readGeminiCertificate,
  regenerateGeminiCertificate,
  selfSignedCertificate,
} from './certificate.ts';

const NOW = new Date('2026-10-23T12:00:00Z');
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

const temporaryDirs: string[] = [];

after(async () => {
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function site(
  overrides: Partial<GeminiCertificateConfig> = {},
): Promise<GeminiCertificateConfig> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-gemini-cert-'));
  temporaryDirs.push(dir);
  return {
    dataDir: path.join(dir, 'data'),
    geminiCert: undefined,
    geminiKey: undefined,
    ...overrides,
  };
}

function certified(result: Awaited<ReturnType<typeof ensureGeminiCertificate>>): GeminiCertificate {
  assert.ok(result.ok, result.ok ? '' : result.problem);
  return result.certificate;
}

describe('the Gemini certificate', () => {
  it('is generated for the host on first use, self-signed and valid for decades', async () => {
    const config = await site();

    const certificate = certified(await ensureGeminiCertificate(config, 'shll.me', NOW));

    const certPem = await readFile(dataPath(config.dataDir, GEMINI_CERTIFICATE), 'utf8');
    const keyPem = await readFile(dataPath(config.dataDir, GEMINI_KEY), 'utf8');
    const x509 = new X509Certificate(certPem);
    assert.equal(x509.checkHost('shll.me'), 'shll.me');
    assert.equal(x509.subject, 'CN=shll.me');
    assert.equal(x509.issuer, x509.subject);
    assert.ok(x509.verify(x509.publicKey), 'signed by its own key');
    assert.ok(x509.checkPrivateKey(createPrivateKey(keyPem)), 'the key on disk is its key');
    assert.ok(new Date(x509.validTo).getTime() - NOW.getTime() > 40 * YEAR_MS);
    assert.ok(new Date(x509.validFrom).getTime() <= NOW.getTime());
    assert.equal(certificate.source, 'generated');
    assert.equal(certificate.fingerprint256, x509.fingerprint256);
    assert.equal(certificate.subject, 'CN=shll.me');
    assert.deepEqual(certificate.validTo, new Date(x509.validTo));
    assert.equal(certificate.coversHost, true);
  });

  it('is well formed whatever serial number it draws', () => {
    for (let drawn = 0; drawn < 1000; drawn += 1) {
      const { cert } = selfSignedCertificate('shll.me', NOW);
      assert.doesNotThrow(() => new X509Certificate(cert), `certificate ${String(drawn)}`);
    }
  });

  it('keeps the key owner-only in an owner-only folder', async () => {
    const config = await site();
    certified(await ensureGeminiCertificate(config, 'shll.me', NOW));

    const key = dataPath(config.dataDir, GEMINI_KEY);
    assert.equal((await stat(key)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(key))).mode & 0o777, 0o700);
  });

  it('is reused on every later start', async () => {
    const config = await site();
    const first = certified(await ensureGeminiCertificate(config, 'shll.me', NOW));

    const second = certified(await ensureGeminiCertificate(config, 'shll.me', NOW));

    assert.equal(second.fingerprint256, first.fingerprint256);
  });

  it('is not replaced when the base URL host changes, and says it no longer matches', async () => {
    const config = await site();
    const first = certified(await ensureGeminiCertificate(config, 'shll.me', NOW));

    const moved = certified(await ensureGeminiCertificate(config, 'andrewshell.org', NOW));

    assert.equal(moved.fingerprint256, first.fingerprint256);
    assert.equal(moved.coversHost, false);
  });

  it('is replaced only when asked, for the host given', async () => {
    const config = await site();
    const first = certified(await ensureGeminiCertificate(config, 'shll.me', NOW));

    const replaced = certified(await regenerateGeminiCertificate(config, 'andrewshell.org', NOW));

    assert.notEqual(replaced.fingerprint256, first.fingerprint256);
    assert.equal(replaced.subject, 'CN=andrewshell.org');
    assert.equal(replaced.coversHost, true);
    const read = certified(await readGeminiCertificate(config, 'andrewshell.org'));
    assert.equal(read.fingerprint256, replaced.fingerprint256);
  });

  it('covers an IP address host', async () => {
    const config = await site();

    const certificate = certified(await ensureGeminiCertificate(config, '127.0.0.1', NOW));

    const x509 = new X509Certificate(
      await readFile(dataPath(config.dataDir, GEMINI_CERTIFICATE), 'utf8'),
    );
    assert.equal(x509.checkIP('127.0.0.1'), '127.0.0.1');
    assert.equal(certificate.coversHost, true);
  });

  it('is not made by reading', async () => {
    const config = await site();

    const result = await readGeminiCertificate(config, 'shll.me');

    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.problem, /no Gemini certificate yet/i);
  });

  it('makes a fresh pair when a crash left a key without its certificate', async () => {
    const config = await site();
    certified(await ensureGeminiCertificate(config, 'shll.me', NOW));
    await rm(dataPath(config.dataDir, GEMINI_CERTIFICATE));

    const certificate = certified(await ensureGeminiCertificate(config, 'shll.me', NOW));

    const x509 = new X509Certificate(
      await readFile(dataPath(config.dataDir, GEMINI_CERTIFICATE), 'utf8'),
    );
    const key = createPrivateKey(await readFile(dataPath(config.dataDir, GEMINI_KEY), 'utf8'));
    assert.ok(x509.checkPrivateKey(key));
    assert.equal(certificate.fingerprint256, x509.fingerprint256);
  });

  it('is refused, not replaced, when the stored key does not belong to it', async () => {
    const config = await site();
    const first = certified(await ensureGeminiCertificate(config, 'shll.me', NOW));
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    await writeFile(
      dataPath(config.dataDir, GEMINI_KEY),
      other.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    );

    const result = await ensureGeminiCertificate(config, 'shll.me', NOW);

    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.problem, /key.pem/);
    const x509 = new X509Certificate(
      await readFile(dataPath(config.dataDir, GEMINI_CERTIFICATE), 'utf8'),
    );
    assert.equal(x509.fingerprint256, first.fingerprint256, 'the certificate is left alone');
  });

  it('serves a TLS handshake', async () => {
    const config = await site();
    const certificate = certified(await ensureGeminiCertificate(config, 'localhost', NOW));

    const server = tls.createServer({ cert: certificate.cert, key: certificate.key }, (socket) => {
      socket.end('20 text/gemini\r\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(typeof address === 'object' && address !== null);
      const seen = await new Promise<string>((resolve, reject) => {
        const socket = tls.connect(
          {
            host: '127.0.0.1',
            port: address.port,
            servername: 'localhost',
            rejectUnauthorized: false,
          },
          () => {
            resolve(socket.getPeerCertificate().fingerprint256);
            socket.end();
          },
        );
        socket.on('error', reject);
      });
      assert.equal(seen, certificate.fingerprint256);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('an operator certificate', () => {
  async function operatorPair(dir: string, host: string): Promise<{ cert: string; key: string }> {
    const elsewhere = await site();
    const made = certified(await ensureGeminiCertificate(elsewhere, host, NOW));
    const cert = path.join(dir, 'operator.crt');
    const key = path.join(dir, 'operator.key');
    await writeFile(cert, made.cert);
    await writeFile(key, made.key);
    return { cert, key };
  }

  it('is used instead of generating one', async () => {
    const base = await site();
    const files = await operatorPair(path.dirname(base.dataDir), 'shll.me');
    const config = { ...base, geminiCert: files.cert, geminiKey: files.key };

    const certificate = certified(await ensureGeminiCertificate(config, 'shll.me', NOW));

    assert.equal(certificate.source, 'operator');
    assert.equal(certificate.certFile, files.cert);
    await assert.rejects(stat(dataPath(config.dataDir, GEMINI_CERTIFICATE)), { code: 'ENOENT' });
  });

  it('is a problem naming the setting and the file when it is missing', async () => {
    const base = await site();
    const missing = path.join(path.dirname(base.dataDir), 'nowhere.crt');
    const config = { ...base, geminiCert: missing, geminiKey: missing };

    const result = await ensureGeminiCertificate(config, 'shll.me', NOW);

    assert.equal(result.ok, false);
    const problem = result.ok ? '' : result.problem;
    assert.match(problem, /GEEKITY_GEMINI_CERT/);
    assert.ok(problem.includes(missing), problem);
  });

  it('is a problem when only one of the two is named', async () => {
    const base = await site();
    const files = await operatorPair(path.dirname(base.dataDir), 'shll.me');

    const result = await ensureGeminiCertificate(
      { ...base, geminiCert: files.cert },
      'shll.me',
      NOW,
    );

    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.problem, /GEEKITY_GEMINI_KEY/);
  });

  it('is a problem when the file is not a certificate', async () => {
    const base = await site();
    const files = await operatorPair(path.dirname(base.dataDir), 'shll.me');
    await writeFile(files.cert, 'not a certificate\n');

    const result = await ensureGeminiCertificate(
      { ...base, geminiCert: files.cert, geminiKey: files.key },
      'shll.me',
      NOW,
    );

    assert.equal(result.ok, false);
    assert.ok((result.ok ? '' : result.problem).includes(files.cert));
  });

  it('is never regenerated', async () => {
    const base = await site();
    const files = await operatorPair(path.dirname(base.dataDir), 'shll.me');
    const before = await readFile(files.cert, 'utf8');

    const result = await regenerateGeminiCertificate(
      { ...base, geminiCert: files.cert, geminiKey: files.key },
      'shll.me',
      NOW,
    );

    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.problem, /GEEKITY_GEMINI_CERT/);
    assert.equal(await readFile(files.cert, 'utf8'), before);
  });
});
