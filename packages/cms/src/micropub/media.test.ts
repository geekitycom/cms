/**
 * The Micropub media endpoint (TASK-165): a client uploads a file into the
 * media library and gets back the URL to name it by in a post.
 */
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import { sandbox } from '../admin/__testing__/harness.ts';
import { createUser } from '../admin/accounts.ts';
import { listUploads } from '../admin/media.ts';
import type { GeekityConfig } from '../config.ts';
import type { Scope } from '../indieauth/request.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const MEDIA = '/_geekity/micropub/media';

interface Site {
  cms: Cms;
  contentDir: string;
  /** A token per user, granted `scopes`. */
  tokens: Record<'ada' | 'grace', string>;
}

async function site(scopes: Scope[] = ['media'], config: GeekityConfig = {}): Promise<Site> {
  const contentDir = await box.dir('geekity-micropub-media-content-');
  const dataDir = await box.dir('geekity-micropub-media-data-');
  const cms = await box.open({ contentDir, dataDir, baseUrl: BASE, ...config });
  const tokens = { ada: '', grace: '' };
  for (const username of ['ada', 'grace'] as const) {
    const user = await createUser({ dataDir, username, password: 'correct horse battery' });
    const issued = await issueTokens(
      dataDir,
      {
        clientId: 'https://app.example/',
        redirectUri: 'https://app.example/callback',
        codeChallenge: 'unused',
        userId: user.id,
        me: `${BASE}/author/${username}/`,
        scopes,
      },
      new Date(),
    );
    tokens[username] = issued.accessToken;
  }
  return { cms, contentDir, tokens };
}

async function photo(): Promise<Uint8Array<ArrayBuffer>> {
  return Uint8Array.from(
    await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 40, g: 90, b: 160 } },
    })
      .png()
      .toBuffer(),
  );
}

async function upload(
  cms: Cms,
  token: string,
  file: { bytes: Uint8Array<ArrayBuffer>; name: string; type: string },
): Promise<Response> {
  const body = new FormData();
  body.set('file', new File([file.bytes], file.name, { type: file.type }));
  return await cms.app.request(MEDIA, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body,
  });
}

async function last(cms: Cms, token: string): Promise<Response> {
  return await cms.app.request(`${MEDIA}?q=last`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Every file under content/uploads, so a refusal can be shown to leave none. */
async function storedFiles(contentDir: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(contentDir, 'uploads'), {
      recursive: true,
      withFileTypes: true,
    });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

describe('uploading a file', () => {
  it('answers 201 with a Location the site serves the file at, and lists it in the media library', async () => {
    const { cms, contentDir, tokens } = await site();
    const bytes = await photo();

    const response = await upload(cms, tokens.ada, {
      bytes,
      name: 'Sunset Photo.png',
      type: 'image/png',
    });

    assert.equal(response.status, 201);
    const location = response.headers.get('location') ?? '';
    assert.match(location, /^https:\/\/blog\.example\/uploads\/\d{4}\/\d{2}\/sunset-photo\.png$/);

    const served = await cms.app.request(new URL(location).pathname);
    assert.equal(served.status, 200);
    assert.deepEqual(new Uint8Array(await served.arrayBuffer()), bytes);

    const library = await listUploads(contentDir);
    assert.deepEqual(
      library.map((file) => `${BASE}${file.url}`),
      [location],
    );
  });

  it('takes the token from an access_token form field as well as the header', async () => {
    const { cms, tokens } = await site();
    const body = new FormData();
    body.set('access_token', tokens.ada);
    body.set('file', new File([await photo()], 'a.png', { type: 'image/png' }));
    const response = await cms.app.request(MEDIA, { method: 'POST', body });
    assert.equal(response.status, 201);
  });
});

describe('a refused upload', () => {
  it('gets 400 for a file over the admin limit, and nothing is stored', async () => {
    const { cms, contentDir, tokens } = await site(['media'], { uploadMaxBytes: 64 });
    const response = await upload(cms, tokens.ada, {
      bytes: await photo(),
      name: 'big.png',
      type: 'image/png',
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as Record<string, string>;
    assert.equal(body['error'], 'invalid_request');
    assert.match(body['error_description'] ?? '', /too big/);
    assert.deepEqual(await storedFiles(contentDir), []);
  });

  it('gets 400 when the declared length is over the limit, before the body is read', async () => {
    const { cms, contentDir, tokens } = await site(['media'], {
      uploadMaxBytes: 64,
      uploadMediaMaxBytes: 64,
    });
    const response = await cms.app.request(MEDIA, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.ada}`,
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(64 * 1024 * 1024),
      },
      body: 'not really multipart',
    });

    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as Record<string, string>)['error'], 'invalid_request');
    assert.deepEqual(await storedFiles(contentDir), []);
  });

  it('gets 400 for a type the media library refuses, and nothing is stored', async () => {
    const { cms, contentDir, tokens } = await site();
    const response = await upload(cms, tokens.ada, {
      bytes: new TextEncoder().encode('#!/bin/sh\necho hi\n'),
      name: 'run.sh',
      type: 'application/x-sh',
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as Record<string, string>;
    assert.equal(body['error'], 'invalid_request');
    assert.match(body['error_description'] ?? '', /\.sh are not allowed/);
    assert.deepEqual(await storedFiles(contentDir), []);
  });

  it('gets 400 for a body that is not multipart', async () => {
    const { cms, tokens } = await site();
    const response = await cms.app.request(MEDIA, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.ada}`,
        'content-type': 'multipart/form-data; boundary=x',
      },
      body: 'not really multipart',
    });
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as Record<string, string>)['error'], 'invalid_request');
  });

  it('gets 400 for a request with no file part', async () => {
    const { cms, tokens } = await site();
    const body = new FormData();
    body.set('photo', 'nothing');
    const response = await cms.app.request(MEDIA, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.ada}` },
      body,
    });
    assert.equal(response.status, 400);
  });
});

describe('the media scope', () => {
  it('refuses a token without it with 403 insufficient_scope, and nothing is stored', async () => {
    const { cms, contentDir, tokens } = await site(['create']);
    const response = await upload(cms, tokens.ada, {
      bytes: await photo(),
      name: 'a.png',
      type: 'image/png',
    });

    assert.equal(response.status, 403);
    assert.equal(
      ((await response.json()) as Record<string, string>)['error'],
      'insufficient_scope',
    );
    assert.match(response.headers.get('www-authenticate') ?? '', /scope="media"/);
    assert.deepEqual(await storedFiles(contentDir), []);
  });

  it('refuses a request with no token with 401', async () => {
    const { cms } = await site();
    const body = new FormData();
    body.set('file', new File([await photo()], 'a.png', { type: 'image/png' }));
    const response = await cms.app.request(MEDIA, { method: 'POST', body });
    assert.equal(response.status, 401);
  });
});

describe('q=last', () => {
  it('answers the URL of the most recent upload by the token’s user, not another user’s', async () => {
    const { cms, tokens } = await site();
    const bytes = await photo();
    await upload(cms, tokens.ada, { bytes, name: 'first.png', type: 'image/png' });
    const second = await upload(cms, tokens.ada, { bytes, name: 'second.png', type: 'image/png' });
    await upload(cms, tokens.grace, { bytes, name: 'grace.png', type: 'image/png' });

    const response = await last(cms, tokens.ada);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { url: second.headers.get('location') });
  });

  it('answers an empty object to a user who has uploaded nothing', async () => {
    const { cms, tokens } = await site();
    await upload(cms, tokens.ada, { bytes: await photo(), name: 'a.png', type: 'image/png' });
    const response = await last(cms, tokens.grace);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
  });

  it('answers 400 to a query it does not answer', async () => {
    const { cms, tokens } = await site();
    const response = await cms.app.request(`${MEDIA}?q=source`, {
      headers: { authorization: `Bearer ${tokens.ada}` },
    });
    assert.equal(response.status, 400);
  });
});

describe('q=config on the Micropub endpoint', () => {
  it('names the media endpoint, which answers there', async () => {
    const { cms, tokens } = await site();
    const response = await cms.app.request('/_geekity/micropub?q=config', {
      headers: { authorization: `Bearer ${tokens.ada}` },
    });
    const config = (await response.json()) as Record<string, string>;
    assert.equal(config['media-endpoint'], `${BASE}${MEDIA}`);
    assert.equal((await last(cms, tokens.ada)).status, 200);
  });
});
