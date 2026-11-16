import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { gifWithMetadata } from '../__testing__/metadata.ts';
import type { Cms } from '../index.ts';
import { UNCITED_CONTEXT_GRACE_MS } from './reply-contexts.ts';

const box = sandbox();

const PREVIEWED = 'https://pages.example/previewed/';
const DRAFTED = 'https://pages.example/drafted/';
const PICTURE = 'https://pages.example/picture.gif';
const DAY_MS = 24 * 60 * 60 * 1000;

let gif: Uint8Array;
let clock = new Date('2026-11-01T00:00:00.000Z');

const original = globalThis.fetch;

before(async () => {
  gif = await gifWithMetadata();
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(new Request(input).url).href;
    if (url === PICTURE) {
      return Promise.resolve(new Response(gif, { headers: { 'content-type': 'image/gif' } }));
    }
    if (url === PREVIEWED) {
      return Promise.resolve(
        new Response(`<title>Previewed</title><meta property="og:image" content="${PICTURE}">`, {
          headers: { 'content-type': 'text/html' },
        }),
      );
    }
    if (url === DRAFTED) {
      return Promise.resolve(
        new Response('<title>Drafted</title>', { headers: { 'content-type': 'text/html' } }),
      );
    }
    return Promise.reject(new TypeError('fetch failed'));
  }) as typeof fetch;
});

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
});

describe('a stored context no post cites', () => {
  let cms: Cms;
  let contentDir: string;
  let agent: Browser;

  before(async () => {
    contentDir = await box.dir('geekity-uncited-content-');
    await mkdir(path.join(contentDir, 'posts'), { recursive: true });
    await writeFile(
      path.join(contentDir, 'posts', '2026-10-31-drafted.md'),
      [
        '---',
        "date: '2026-10-31T09:00:00Z'",
        'permalink: /2026/10/drafted/',
        'draft: true',
        `bookmark-of: ${DRAFTED}`,
        '---',
        '',
        'Not yet.',
        '',
      ].join('\n'),
    );
    cms = await box.open({
      contentDir,
      dataDir: await box.dir('geekity-uncited-data-'),
      hostLookup: () => Promise.resolve(['203.0.113.7']),
      now: () => clock,
    });
    await cms.replyContexts.settled();
    agent = await signedIn(cms);
    const csrf = csrfField(await (await agent.get('/admin/posts/new?kind=link')).text()) ?? '';
    const preview = await agent.post('/admin/cited-preview', {
      csrf_token: csrf,
      url: PREVIEWED,
      property: 'bookmark-of',
    });
    assert.equal(preview.status, 200);
  });

  async function sweepAt(when: Date): Promise<void> {
    clock = when;
    cms.replyContexts.catchUp();
    await cms.replyContexts.settled();
  }

  async function pictures(): Promise<number> {
    return (await readdir(path.join(contentDir, 'uploads', 'cited'))).length;
  }

  it('is kept, with its picture, while the grace period runs', async () => {
    assert.equal(await pictures(), 1);

    await sweepAt(new Date(clock.getTime() + UNCITED_CONTEXT_GRACE_MS - DAY_MS));

    assert.notEqual(cms.replyContexts.stored(PREVIEWED), undefined);
    assert.equal(await pictures(), 1);
  });

  it('is removed with its picture once the grace period is over', async () => {
    await sweepAt(new Date(clock.getTime() + 2 * DAY_MS));

    assert.equal(cms.replyContexts.stored(PREVIEWED), undefined);
    assert.equal(await pictures(), 0);
  });

  it('is never removed while a draft cites it', () => {
    assert.notEqual(cms.replyContexts.stored(DRAFTED), undefined);
  });
});
