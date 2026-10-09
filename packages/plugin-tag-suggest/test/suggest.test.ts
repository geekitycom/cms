import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import llm from '@geekity/plugin-llm';

import tagSuggest, { hashtagKey } from '../src/index.ts';
import { SEED } from '../src/seed.ts';
import { VERSION } from '../src/version.ts';
import {
  fakeProvider,
  OPENROUTER_BASE_URL,
  replying,
  standInForOpenRouter,
  thinker,
} from '../../plugin-llm/test/provider.ts';
import type { FakeProvider } from '../../plugin-llm/test/provider.ts';
import { actionUrl, buttonsOn, closeSites, TAGS, tagSite } from './site.ts';
import { fakeTagsPub } from './tags-pub.ts';
import type { FakeTagsPub } from './tags-pub.ts';

/**
 * Suggest tags (TASK-286), pressed through the site's editor endpoint against
 * a fake provider and a fake tags.pub.
 */

const KEY = 'sk-tags-key';
const POSTS = {
  'web.md':
    '---\ntitle: Owning It\ndate: 2026-09-01T09:00:00Z\ntags: [IndieWeb, Blogging]\n---\n\nMine.\n',
  'feeds.md': '---\ntitle: Feeds\ndate: 2026-09-02T09:00:00Z\ntags: [IndieWeb]\n---\n\nRSS.\n',
};

let provider: FakeProvider;
let tagsPub: FakeTagsPub;

before(async () => {
  provider = await fakeProvider();
  tagsPub = await fakeTagsPub();
});
beforeEach(() => {
  provider.received.length = 0;
  tagsPub.reset();
});
after(async () => {
  await closeSites();
  await provider.close();
  await tagsPub.close();
});

const site = (
  options: {
    apiKey?: string | undefined;
    enabled?: boolean;
    baseUrl?: string;
    model?: string;
  } = { apiKey: KEY },
) =>
  tagSite([llm, tagSuggest], {
    baseUrl: provider.baseUrl,
    tagsServer: tagsPub.url,
    posts: POSTS,
    ...options,
  });

function modelSays(forThisPost: string[], forReach: string[] = []): void {
  provider.answer(replying(JSON.stringify({ forThisPost, forReach })));
}

interface Choice {
  value: string;
  note?: string;
  badge?: string;
  group?: string;
}

interface Sent {
  messages: { role: string; content: string }[];
}

const POST = 'For this post';
const REACH = 'For reach';

const WORDCAMP = {
  title: 'WordCamp US',
  body:
    'About a month ago, I went to WordCamp US in Phoenix. It was an okay conference, and I met some nice people.\n\n' +
    "Overall, I'm not sure I'll go again. I don't think I'm involved enough in the WordPress ecosystem to get much out of it.",
};

async function suggest(
  admin: Awaited<ReturnType<typeof site>>['admin'],
  fields: Record<string, string> = {},
): Promise<{ ok: boolean; choices?: Choice[]; message?: string }> {
  const response = await admin.post(actionUrl('suggest-tags'), {
    type: 'post',
    title: 'Owning my words',
    body: 'Why I publish on my own site and syndicate elsewhere.',
    ...fields,
  });
  assert.equal(response.status, 200);
  return (await response.json()) as { ok: boolean; choices?: Choice[]; message?: string };
}

const looked = () => tagsPub.lookups.map((lookup) => lookup.path).sort();

describe('hashtagKey', () => {
  it('folds a tag the way tags.pub names its accounts', () => {
    assert.equal(hashtagKey('#IndieWeb'), 'indieweb');
    assert.equal(hashtagKey('Sour Dough'), 'sourdough');
    assert.equal(hashtagKey('indie-web'), 'indieweb');
    assert.equal(hashtagKey('Café'), 'cafe');
    assert.equal(hashtagKey('web_3.0'), 'web30');
    assert.equal(hashtagKey('#日本'), '');
  });
});

describe('Suggest tags', () => {
  it('sits beside Tags only', async () => {
    const { admin } = await site();
    const html = await (await admin.get('/admin/posts/new')).text();
    assert.deepEqual(buttonsOn(html), ['Suggest tags']);
    assert.ok(html.includes(`data-editor-action="${actionUrl('suggest-tags')}"`));
  });

  it('normalises and deduplicates the candidates before looking any up', async () => {
    const { admin } = await site();
    modelSays(['#IndieWeb', 'indieweb', 'indie-web', 'Café', 'cafe', 'Sour Dough', '#日本', ' ']);
    const answer = await suggest(admin);
    assert.deepEqual(looked(), [
      '/user/cafe/followers',
      '/user/indieweb/followers',
      '/user/sourdough/followers',
    ]);
    assert.deepEqual(
      answer.choices?.map((choice) => choice.value),
      ['IndieWeb', 'Café', 'SourDough'],
    );
  });

  it('tells the model the draft and the tags the site uses, most used first', async () => {
    const { admin } = await site();
    modelSays(['owning']);
    await suggest(admin);
    const sent = JSON.stringify(provider.received[0]?.body);
    assert.match(sent, /Owning my words/);
    assert.match(sent, /syndicate elsewhere/);
    assert.match(sent, /IndieWeb, Blogging/);
  });

  it('puts the site’s own tags first, then keeps the model’s order whatever the follower counts', async () => {
    const { admin } = await site();
    tagsPub.followers.set('indieweb', 13);
    tagsPub.followers.set('blogging', 240);
    tagsPub.followers.set('pkm', 1);
    tagsPub.followers.set('wordpress', 300);
    modelSays(['owning', 'pkm', 'IndieWeb', 'WordPress', 'Blogging']);
    const answer = await suggest(admin);
    assert.deepEqual(answer, {
      ok: true,
      choices: [
        { value: 'IndieWeb', note: '13 followers on tags.pub', badge: 'Used here', group: POST },
        { value: 'Blogging', note: '240 followers on tags.pub', badge: 'Used here', group: POST },
        { value: 'owning', note: 'No followers on tags.pub', group: POST },
        { value: 'pkm', note: '1 follower on tags.pub', group: POST },
        { value: 'WordPress', note: '300 followers on tags.pub', group: POST },
      ],
    });
  });

  it('keeps the model’s order when no count tells its tags apart', async () => {
    const { admin } = await site();
    tagsPub.followers.set('phoenix', 1);
    modelSays(['WordCampUS', 'Phoenix', 'Conferences']);
    const answer = await suggest(admin, WORDCAMP);
    assert.deepEqual(
      answer.choices?.map((choice) => choice.value),
      ['WordCampUS', 'Phoenix', 'Conferences'],
    );
  });

  it('keeps a readable spelling to accept and looks up only the folded key', async () => {
    const { admin } = await site();
    modelSays(['WordCamp US', 'word-press', 'phoenix']);
    const answer = await suggest(admin, WORDCAMP);
    assert.deepEqual(
      answer.choices?.map((choice) => choice.value),
      ['WordCampUS', 'WordPress', 'phoenix'],
    );
    assert.deepEqual(looked(), [
      '/user/phoenix/followers',
      '/user/wordcampus/followers',
      '/user/wordpress/followers',
    ]);
  });

  it('takes no more than five tags for the post', async () => {
    const { admin } = await site();
    modelSays(['one', 'two', 'three', 'four', 'five', 'six', 'seven']);
    const answer = await suggest(admin);
    assert.deepEqual(
      answer.choices?.map((choice) => choice.value),
      ['one', 'two', 'three', 'four', 'five'],
    );
  });

  it('offers reach tags from the seed list under their own heading, most followed first, each once', async () => {
    const { admin } = await site();
    tagsPub.followers.set('wordpress', 40);
    tagsPub.followers.set('fediverse', 900);
    modelSays(
      ['WordCampUS', 'WordPress'],
      ['wordpress', 'OpenSource', 'Fediverse', 'WordCampPhoenix', 'IndieWeb'],
    );
    const answer = await suggest(admin, WORDCAMP);
    assert.deepEqual(
      answer.choices?.map(({ value, group, badge }) => ({ value, group, badge })),
      [
        { value: 'WordCampUS', group: POST, badge: undefined },
        { value: 'WordPress', group: POST, badge: undefined },
        { value: 'Fediverse', group: REACH, badge: undefined },
        { value: 'OpenSource', group: REACH, badge: undefined },
        { value: 'IndieWeb', group: REACH, badge: 'Used here' },
      ],
    );
    assert.ok(
      !looked().includes('/user/wordcampphoenix/followers'),
      'a tag off the seed list is never offered for reach',
    );
  });

  it('ranks reach tags by the seed’s count when tags.pub gives none or fewer', async () => {
    const { admin } = await site();
    tagsPub.failWith = 503;
    modelSays([], ['linux', 'palestine', 'wordpress']);
    const answer = await suggest(admin);
    assert.deepEqual(
      answer.choices?.map((choice) => choice.value),
      ['palestine', 'linux', 'wordpress'],
    );
  });

  it('tells the model to use a site tag only when the post is about it, and how to spell and pick tags', async () => {
    const { admin } = await site();
    modelSays(['WordCampUS']);
    await suggest(admin, WORDCAMP);
    const [system, user] = (provider.received[0]?.body as Sent).messages.map((m) => m.content);
    assert.match(
      system ?? '',
      /3 to 5 tags for what this post is specifically about, most fitting first/,
    );
    assert.match(system ?? '', /Avoid generic words/);
    assert.match(system ?? '', /only when this post is about that subject/);
    assert.match(system ?? '', /that the site uses a tag is no reason by itself to suggest it/);
    assert.match(system ?? '', /CamelCase, each word capitalised, such as WordCampUS/);
    assert.doesNotMatch(system ?? '', /Prefer a tag the site already uses/);
    assert.match(user ?? '', /suggest one only when this post is about it\): IndieWeb, Blogging/);
  });

  it('gives the model the seed list and tells it to pick only the ones that fit', async () => {
    const { admin } = await site();
    modelSays(['WordCampUS']);
    await suggest(admin, WORDCAMP);
    const system = (provider.received[0]?.body as Sent).messages[0]?.content ?? '';
    assert.match(system, /that this post is genuinely about/);
    assert.match(system, /Never pick one only because many people follow it/);
    const listed = /Hashtags people follow, most followed first: (.*)$/
      .exec(system)?.[1]
      ?.split(', ');
    assert.deepEqual(
      listed,
      SEED.tags.map(([name]) => name),
    );
  });

  it('caches counts for a day, so a second suggestion asks tags.pub nothing', async () => {
    const { admin, dataDir } = await site();
    tagsPub.followers.set('indieweb', 13);
    modelSays(['indieweb', 'owning']);
    await suggest(admin);
    assert.equal(tagsPub.lookups.length, 2);

    modelSays(['IndieWeb', 'owning']);
    const again = await suggest(admin);
    assert.equal(tagsPub.lookups.length, 2, 'no request the second time');
    assert.equal(again.choices?.[0]?.note, '13 followers on tags.pub');

    const file = path.join(dataDir, 'plugins', TAGS, 'followers.json');
    const cached = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { at: string }>;
    assert.deepEqual(Object.keys(cached).sort(), ['indieweb', 'owning']);
  });

  it('asks again for a count cached more than a day ago', async () => {
    const { admin, dataDir } = await site();
    const folder = path.join(dataDir, 'plugins', TAGS);
    mkdirSync(folder, { recursive: true });
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    writeFileSync(
      path.join(folder, 'followers.json'),
      JSON.stringify({
        indieweb: { followers: 2, at: stale },
        owning: { followers: 7, at: fresh },
      }),
    );
    tagsPub.followers.set('indieweb', 13);
    modelSays(['indieweb', 'owning']);
    const answer = await suggest(admin);
    assert.deepEqual(looked(), ['/user/indieweb/followers']);
    assert.deepEqual(
      answer.choices?.map((choice) => choice.note),
      ['13 followers on tags.pub', '7 followers on tags.pub'],
    );
  });

  it('sends a User-Agent naming the plugin and the site, and runs four lookups at a time', async () => {
    const { admin } = await site();
    tagsPub.delayMs = 40;
    modelSays(
      ['one', 'two', 'three', 'four', 'five'],
      ['fediverse', 'mastodon', 'linux', 'opensource'],
    );
    const answer = await suggest(admin);
    assert.equal(answer.choices?.length, 9);
    assert.equal(tagsPub.lookups.length, 9);
    assert.equal(tagsPub.mostAtOnce, 4);
    for (const lookup of tagsPub.lookups) {
      assert.equal(
        lookup.headers['user-agent'],
        `Geekity-Tag-Suggest/${VERSION} (+http://localhost:3000)`,
      );
      assert.equal(lookup.headers.accept, 'application/activity+json');
    }
  });

  it('still offers the candidates, without counts, when tags.pub fails, and caches nothing', async () => {
    const { admin, dataDir } = await site();
    tagsPub.failWith = 503;
    modelSays(['owning', 'IndieWeb']);
    const answer = await suggest(admin);
    assert.deepEqual(answer, {
      ok: true,
      choices: [
        {
          value: 'IndieWeb',
          note: 'Followers unknown: tags.pub answered 503',
          badge: 'Used here',
          group: POST,
        },
        { value: 'owning', note: 'Followers unknown: tags.pub answered 503', group: POST },
      ],
    });
    assert.throws(() => readFileSync(path.join(dataDir, 'plugins', TAGS, 'followers.json')));
  });

  it('says what went wrong with the model in plain words, asking tags.pub nothing', async () => {
    const { admin } = await site({ apiKey: undefined });
    assert.deepEqual(await suggest(admin), {
      ok: false,
      message: 'No API key is set on Plugins > LLM, so nothing was sent.',
    });
    assert.deepEqual(tagsPub.lookups, []);
  });

  it('suggests tags from a reasoning model on OpenRouter, asked to keep its reasoning short', async () => {
    const stop = standInForOpenRouter(provider);
    try {
      const { admin } = await site({
        apiKey: KEY,
        baseUrl: OPENROUTER_BASE_URL,
        model: 'acme/thinker',
      });
      provider.answer(thinker(JSON.stringify({ forThisPost: ['IndieWeb'], forReach: [] })));
      const answer = await suggest(admin);
      assert.equal(answer.ok, true);
      assert.deepEqual(
        answer.choices?.map((choice) => choice.value),
        ['IndieWeb'],
      );
    } finally {
      stop();
    }
  });

  it('shows why a reply was cut off, in the words the LLM plugin gives', async () => {
    const stop = standInForOpenRouter(provider);
    try {
      const { admin } = await site({
        apiKey: KEY,
        baseUrl: OPENROUTER_BASE_URL,
        model: 'acme/unlisted',
      });
      provider.answer(thinker(JSON.stringify({ forThisPost: ['never'], forReach: [] })));
      const answer = await suggest(admin);
      assert.equal(answer.ok, false);
      assert.match(answer.message ?? '', /stopped at its limit of 4096 tokens/);
      assert.deepEqual(tagsPub.lookups, []);
    } finally {
      stop();
    }
  });

  it('asks nothing of an empty draft', async () => {
    const { admin } = await site();
    assert.deepEqual(await suggest(admin, { title: '', body: '  ' }), {
      ok: false,
      message: 'Write some of the post first. There is nothing to read yet.',
    });
    assert.deepEqual(provider.received, []);
  });

  it('says so when no candidate survives', async () => {
    const { admin } = await site();
    modelSays(['#日本', '...'], ['NotOnTheSeedList']);
    assert.deepEqual(await suggest(admin), {
      ok: false,
      message: 'The model suggested no tags that tags.pub can look up. Try again.',
    });
  });
});
