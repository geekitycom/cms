import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it, mock } from 'node:test';

import { GEMINI_CERTIFICATE, dataPath } from '../files/data-files.ts';
import { createCms } from '../index.ts';
import type { GeekityConfig } from '../config.ts';

const temporaryDirs: string[] = [];

after(async () => {
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dirs(
  site: Record<string, unknown>,
): Promise<{ contentDir: string; dataDir: string }> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-gemini-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-gemini-data-'));
  temporaryDirs.push(contentDir, dataDir);
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(path.join(contentDir, '_data', 'site.json'), JSON.stringify(site));
  return { contentDir, dataDir };
}

async function servedOnce(config: GeekityConfig): Promise<void> {
  const cms = createCms({ watch: false, port: 0, ...config });
  try {
    await cms.serve();
  } finally {
    await cms.close();
  }
}

describe('starting a site with Gemini on', () => {
  it('writes a certificate for the base URL host, and reuses it on the next start', async () => {
    const site = await dirs({ gemini: true });
    const baseUrl = 'https://shll.me';
    const certFile = dataPath(site.dataDir, GEMINI_CERTIFICATE);

    await servedOnce({ ...site, baseUrl });
    const first = await readFile(certFile, 'utf8');
    assert.equal(new X509Certificate(first).checkHost('shll.me'), 'shll.me');

    await servedOnce({ ...site, baseUrl: 'https://andrewshell.org' });
    assert.equal(await readFile(certFile, 'utf8'), first, 'a new host does not replace it');
  });

  it('writes nothing while Gemini is off', async () => {
    const site = await dirs({});

    await servedOnce({ ...site, baseUrl: 'https://shll.me' });

    await assert.rejects(stat(dataPath(site.dataDir, GEMINI_CERTIFICATE)), { code: 'ENOENT' });
  });

  it('says what is wrong with an operator certificate and serves HTTP anyway', async () => {
    const site = await dirs({ gemini: true });
    const missing = path.join(site.dataDir, 'nowhere.crt');
    const warn = mock.method(console, 'warn', () => undefined);
    const cms = createCms({
      ...site,
      watch: false,
      port: 0,
      baseUrl: 'https://shll.me',
      geminiCert: missing,
      geminiKey: missing,
    });
    try {
      const { port } = await cms.serve();
      const response = await fetch(`http://127.0.0.1:${String(port)}/healthz`);
      assert.equal(response.status, 200);
      const warned = warn.mock.calls.map((call) => String(call.arguments[0]));
      assert.ok(
        warned.some((line) => line.includes('GEEKITY_GEMINI_CERT') && line.includes(missing)),
        warned.join('\n'),
      );
    } finally {
      warn.mock.restore();
      await cms.close();
    }
  });
});
