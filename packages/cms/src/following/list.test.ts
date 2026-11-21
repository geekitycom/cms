import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { settingsOver } from '../__testing__/settings.ts';
import { resolveConfig } from '../config.ts';
import type { NotificationTimers } from '../notifications/digest.ts';
import type { HostLookup } from '../util/public-address.ts';
import {
  createFollowingService,
  FOLLOWING_REFRESH_MS,
  followingStatus,
  readFollowing,
  servedFollowing,
} from './list.ts';
import type { FollowingService } from './list.ts';

const box = sandbox();
after(() => box.cleanup());

const SOURCE = 'https://public.example/index.opml';
const ALTERNATE = 'https://public.example/index.opml?format=opml';

const FRESHRSS = readFileSync(
  path.join(import.meta.dirname, '__fixtures__', 'freshrss.opml'),
  'utf8',
);
const PAGE = readFileSync(path.join(import.meta.dirname, '__fixtures__', 'page.html'), 'utf8');

interface Sent {
  readonly url: string;
  readonly headers: Headers;
}

type Answer = (sent: Sent) => Response;

const answers = new Map<string, Answer>();
const sent: Sent[] = [];

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  const request = { url, headers: new Headers(init?.headers) };
  sent.push(request);
  const answer = answers.get(url);
  return Promise.resolve(
    answer === undefined ? new Response('missing', { status: 404 }) : answer(request),
  );
}) as typeof fetch;
after(() => {
  globalThis.fetch = original;
});

beforeEach(() => {
  answers.clear();
  sent.length = 0;
});

const publicLookup: HostLookup = () => Promise.resolve(['203.0.113.7']);
const privateLookup: HostLookup = () => Promise.resolve(['10.0.0.5']);

function opml(body: string, headers: Record<string, string> = {}): Answer {
  return () =>
    new Response(body, { headers: { 'content-type': 'text/x-opml; charset=utf-8', ...headers } });
}

const fakeTimers = (): NotificationTimers & { tick(): void; everyMs: number | undefined } => {
  let callback: (() => void) | undefined;
  const timers = {
    everyMs: undefined as number | undefined,
    set(run: () => void, everyMs: number) {
      callback = run;
      timers.everyMs = everyMs;
      return 1;
    },
    clear() {
      callback = undefined;
    },
    tick() {
      callback?.();
    },
  };
  return timers;
};

async function siteFollowing(
  source: string,
  options: { lookup?: HostLookup; now?: () => Date; timers?: NotificationTimers } = {},
): Promise<{ service: FollowingService; dataDir: string }> {
  const contentDir = await box.dir('geekity-following-content-');
  const dataDir = await box.dir('geekity-following-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ followingOpml: source }),
    'utf8',
  );
  const config = resolveConfig(
    {
      contentDir,
      dataDir,
      hostLookup: options.lookup ?? publicLookup,
      ...(options.now === undefined ? {} : { now: options.now }),
    },
    { env: {} },
  );
  const service = createFollowingService({
    config,
    settings: settingsOver({ contentDir, dataDir }),
    timers: options.timers ?? fakeTimers(),
    logger: { warn: () => undefined },
  });
  return { service, dataDir };
}

describe('the following list', () => {
  it('asks for OPML and stores the list it is answered with', async () => {
    answers.set(SOURCE, opml(FRESHRSS, { etag: '"v1"' }));
    const { service, dataDir } = await siteFollowing(SOURCE);

    await service.refresh();

    assert.equal(
      sent[0]?.headers.get('accept'),
      'text/x-opml, application/xml;q=0.9, text/xml;q=0.8, text/html;q=0.1',
    );
    const list = servedFollowing(dataDir, SOURCE);
    assert.deepEqual(
      list?.feeds.map((feed) => feed.xmlUrl),
      [
        'https://aaronparecki.com/feed.xml',
        'https://tantek.com/updates.atom',
        'https://nodejs.org/en/feed/blog.xml',
      ],
    );
    assert.equal(list?.etag, '"v1"');
    assert.deepEqual(followingStatus(dataDir, SOURCE), {
      fetchedAt: list?.fetchedAt,
      feedCount: 3,
    });
  });

  it('reads a list in the encoding its XML declaration names', async () => {
    const list = `<?xml version="1.0" encoding="ISO-8859-1"?>
<opml version="2.0"><body>
  <outline type="rss" text="Café" xmlUrl="https://cafe.example/feed.xml"/>
</body></opml>`;
    answers.set(
      SOURCE,
      () =>
        new Response(
          Uint8Array.from(list, (char) => char.charCodeAt(0)),
          {
            headers: { 'content-type': 'text/x-opml' },
          },
        ),
    );
    const { service, dataDir } = await siteFollowing(SOURCE);

    await service.refresh();

    assert.deepEqual(
      servedFollowing(dataDir, SOURCE)?.feeds.map((feed) => feed.text),
      ['Café'],
    );
  });

  it('follows the OPML alternate a web page names, once', async () => {
    answers.set(SOURCE, () => new Response(PAGE, { headers: { 'content-type': 'text/html' } }));
    answers.set(ALTERNATE, opml(FRESHRSS));
    const { service, dataDir } = await siteFollowing(SOURCE);

    await service.refresh();

    assert.deepEqual(
      sent.map((each) => each.url),
      [SOURCE, ALTERNATE],
    );
    assert.equal(servedFollowing(dataDir, SOURCE)?.feeds.length, 3);
    assert.equal(servedFollowing(dataDir, SOURCE)?.opmlUrl, ALTERNATE);
  });

  it('does not follow a second page from the alternate', async () => {
    const html = () => new Response(PAGE, { headers: { 'content-type': 'text/html' } });
    answers.set(SOURCE, html);
    answers.set(ALTERNATE, html);
    const { service, dataDir } = await siteFollowing(SOURCE);

    await service.refresh();

    assert.equal(sent.length, 2);
    assert.equal(servedFollowing(dataDir, SOURCE), undefined);
    assert.match(followingStatus(dataDir, SOURCE)?.failure?.reason ?? '', /answered a web page/);
  });

  it('sends the validators it was given, and a 304 keeps the list', async () => {
    answers.set(
      SOURCE,
      opml(FRESHRSS, { etag: '"v1"', 'last-modified': 'Mon, 16 Nov 2026 18:00:00 GMT' }),
    );
    let now = new Date('2026-11-16T18:00:00Z');
    const { service, dataDir } = await siteFollowing(SOURCE, { now: () => now });
    await service.refresh();

    answers.set(SOURCE, () => new Response(null, { status: 304 }));
    now = new Date('2026-11-17T00:00:00Z');
    await service.refresh();

    assert.equal(sent[1]?.headers.get('if-none-match'), '"v1"');
    assert.equal(sent[1]?.headers.get('if-modified-since'), 'Mon, 16 Nov 2026 18:00:00 GMT');
    const list = servedFollowing(dataDir, SOURCE);
    assert.equal(list?.feeds.length, 3);
    assert.equal(list?.fetchedAt, '2026-11-17T00:00:00.000Z');
    assert.equal(list?.changedAt, '2026-11-16T18:00:00.000Z');
  });

  it('keeps the last good list when a refetch fails, and says why', async () => {
    answers.set(SOURCE, opml(FRESHRSS));
    const { service, dataDir } = await siteFollowing(SOURCE);
    await service.refresh();
    const good = servedFollowing(dataDir, SOURCE);

    answers.set(SOURCE, opml('<opml version="2.0"><body><outline></body></opml>'));
    await service.refresh();

    assert.deepEqual(servedFollowing(dataDir, SOURCE), good);
    assert.match(
      followingStatus(dataDir, SOURCE)?.failure?.reason ?? '',
      /not OPML: not well-formed/,
    );

    answers.set(SOURCE, () => new Response('down', { status: 503 }));
    await service.refresh();
    assert.deepEqual(servedFollowing(dataDir, SOURCE), good);
    assert.match(followingStatus(dataDir, SOURCE)?.failure?.reason ?? '', /answered 503/);

    answers.set(SOURCE, opml(FRESHRSS));
    await service.refresh();
    assert.equal(
      followingStatus(dataDir, SOURCE)?.failure,
      undefined,
      'a fetch that works clears the error',
    );
  });

  it('refuses an address that is not public', async () => {
    answers.set(SOURCE, opml(FRESHRSS));
    const { service, dataDir } = await siteFollowing(SOURCE, { lookup: privateLookup });

    await service.refresh();

    assert.equal(sent.length, 0);
    assert.equal(servedFollowing(dataDir, SOURCE), undefined);
    assert.equal(followingStatus(dataDir, SOURCE)?.failure?.reason, 'not a public address');
  });

  it('refuses a list larger than the limit', async () => {
    answers.set(SOURCE, opml(FRESHRSS, { 'content-length': String(3_000_000) }));
    const { service, dataDir } = await siteFollowing(SOURCE);

    await service.refresh();

    assert.match(followingStatus(dataDir, SOURCE)?.failure?.reason ?? '', /larger than/);
  });

  it('serves nothing for a different address than the one fetched', async () => {
    answers.set(SOURCE, opml(FRESHRSS));
    const { service, dataDir } = await siteFollowing(SOURCE);
    await service.refresh();

    assert.equal(servedFollowing(dataDir, 'https://other.example/list.opml'), undefined);
    assert.equal(servedFollowing(dataDir, ''), undefined);
    assert.equal(followingStatus(dataDir, 'https://other.example/list.opml'), undefined);
  });

  it('fetches on start when nothing is stored, then on every tick', async () => {
    answers.set(SOURCE, opml(FRESHRSS));
    const timers = fakeTimers();
    const { service, dataDir } = await siteFollowing(SOURCE, { timers });

    service.start();
    await service.settled();
    assert.ok(readFollowing(dataDir) !== undefined);
    assert.equal(sent.length, 1);
    assert.equal(timers.everyMs, FOLLOWING_REFRESH_MS);

    timers.tick();
    await service.settled();
    assert.equal(sent.length, 2);
    service.stop();
  });

  it('does not fetch on start while the stored list is fresh', async () => {
    answers.set(SOURCE, opml(FRESHRSS));
    const { service: first, dataDir } = await siteFollowing(SOURCE);
    await first.refresh();
    sent.length = 0;

    const again = createFollowingService({
      config: resolveConfig({ dataDir, hostLookup: publicLookup }, { env: {} }),
      settings: { get: () => Promise.resolve(SOURCE) } as never,
      timers: fakeTimers(),
      logger: { warn: () => undefined },
    });
    again.start();
    await again.settled();
    assert.equal(sent.length, 0);
    again.stop();
  });

  it('fetches when the setting changes only once started', async () => {
    answers.set(SOURCE, opml(FRESHRSS));
    const { service } = await siteFollowing(SOURCE);

    service.settingChanged();
    await service.settled();
    assert.equal(sent.length, 0);
  });

  it('reads a damaged record as none', async () => {
    const dataDir = await box.dir('geekity-following-damaged-');
    await writeFile(path.join(dataDir, 'following.json'), '{ nope', 'utf8');
    assert.equal(readFollowing(dataDir), undefined);
  });
});
