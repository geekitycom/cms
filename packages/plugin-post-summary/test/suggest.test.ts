import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';

import llm from '@geekity/plugin-llm';
import type { LlmFailure } from '@geekity/plugin-llm';

import summary, {
  cleanTitle,
  DESCRIPTION_CHARACTERS,
  DESCRIPTION_WORDS,
  failureWords,
  fitDescription,
} from '../src/index.ts';
import { fakeProvider, replying } from './provider.ts';
import type { FakeProvider } from './provider.ts';
import { actionUrl, buttonsOn, closeSites, summarySite } from './site.ts';

/**
 * Suggest title and Suggest description (TASK-285), pressed through the
 * site's editor endpoints against a fake provider.
 */

const KEY = 'sk-summary-key';
const POSTS = {
  'liked.md':
    '---\ndate: 2026-10-01T09:00:00Z\nlike-of: https://elsewhere.example/a\n---\n\nGood.\n',
  'reply.md':
    '---\ndate: 2026-10-01T09:00:00Z\nin-reply-to: https://elsewhere.example/b\n---\n\nAgreed.\n',
  'snap.md':
    '---\ndate: 2026-10-01T09:00:00Z\nphoto:\n  - https://elsewhere.example/c.jpg\n---\n\nLook.\n',
  'note.md': '---\ndate: 2026-10-01T09:00:00Z\n---\n\nA passing thought.\n',
  'on-bread.md': '---\ntitle: On Bread\ndate: 2026-10-01T09:00:00Z\n---\n\nAbout sourdough.\n',
};

let provider: FakeProvider;

before(async () => {
  provider = await fakeProvider();
});
beforeEach(() => {
  provider.received.length = 0;
});
after(async () => {
  await closeSites();
  await provider.close();
});

const site = (options: { apiKey?: string | undefined; enabled?: boolean } = { apiKey: KEY }) =>
  summarySite([llm, summary], { baseUrl: provider.baseUrl, posts: POSTS, ...options });

interface Sent {
  messages: { role: string; content: string }[];
  response_format: { json_schema: { schema: unknown } };
}

describe('Suggest title and Suggest description', () => {
  it('asks the model about the draft as the editor holds it and answers the suggestion', async () => {
    const { admin } = await site();
    provider.answer(replying(JSON.stringify({ title: '“Keeping a Starter Alive.”' })));
    const response = await admin.post(actionUrl('suggest-title'), {
      type: 'post',
      title: '',
      body: 'Feed it flour and water every day.',
      lang: 'fr',
    });
    assert.deepEqual(await response.json(), { ok: true, value: 'Keeping a Starter Alive' });

    const [sent] = provider.received;
    const body = sent?.body as Sent;
    assert.match(body.messages[1]?.content ?? '', /Feed it flour and water every day\./);
    assert.match(body.messages[0]?.content ?? '', /"fr"/);
    assert.deepEqual(body.response_format.json_schema.schema, {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
      additionalProperties: false,
    });
  });

  it('keeps a description within the 280 characters and 55 words listings and feeds use', async () => {
    const { admin } = await site();
    const long = Array.from({ length: 12 }, (_, n) => `Sentence ${String(n)} says a little more.`);
    provider.answer(replying(JSON.stringify({ description: long.join(' ') })));
    const response = await admin.post(actionUrl('suggest-description'), {
      type: 'post',
      title: 'On Bread',
      body: 'About sourdough.',
    });
    const { value } = (await response.json()) as { value: string };
    assert.ok(value.length <= DESCRIPTION_CHARACTERS, value);
    assert.ok(value.split(' ').length <= DESCRIPTION_WORDS, value);
    assert.match(value, /^Sentence 0 says a little more\..*more\.$/);
  });

  it('offers no title for a like, a reply, a photo or a saved note, and both for an article', async () => {
    const { admin } = await site();
    const labels = async (url: string) => buttonsOn(await (await admin.get(url)).text());
    for (const slug of ['liked', 'reply', 'snap', 'note']) {
      assert.deepEqual(await labels(`/admin/posts/${slug}`), ['Suggest description'], slug);
    }
    assert.deepEqual(await labels('/admin/posts/on-bread'), [
      'Suggest title',
      'Suggest description',
    ]);
    assert.deepEqual(await labels('/admin/posts/new'), ['Suggest title', 'Suggest description']);
    assert.deepEqual(await labels('/admin/pages/new'), ['Suggest title', 'Suggest description']);
  });

  it('withdraws Suggest title once the draft becomes a like, and sends nothing', async () => {
    const { admin } = await site();
    const response = await admin.post(actionUrl('suggest-title'), {
      type: 'post',
      body: 'Nice.',
      'like-of': 'https://elsewhere.example/a',
    });
    assert.deepEqual(await response.json(), {
      ok: false,
      withdrawn: true,
      message: 'Suggest title is not offered for a like.',
    });
    assert.equal(provider.received.length, 0);
  });

  it('explains how to configure the model when no API key is set, and sends nothing', async () => {
    const { admin } = await site({});
    const response = await admin.post(actionUrl('suggest-description'), {
      type: 'post',
      body: 'Words.',
    });
    assert.deepEqual(await response.json(), {
      ok: false,
      message: 'No language model is set up yet. Add an API key on Plugins > LLM, then try again.',
    });
    assert.equal(provider.received.length, 0);
  });

  it('says what the provider’s refusal means, in plain words', async () => {
    const { admin } = await site();
    provider.answer({ status: 401, body: JSON.stringify({ error: { message: 'bad key' } }) });
    const response = await admin.post(actionUrl('suggest-title'), {
      type: 'post',
      body: 'Words.',
    });
    assert.deepEqual(await response.json(), {
      ok: false,
      message: 'The language model provider refused the API key. Check the key on Plugins > LLM.',
    });
  });

  it('asks nothing for an empty draft', async () => {
    const { admin } = await site();
    const response = await admin.post(actionUrl('suggest-title'), { type: 'post', body: '  ' });
    assert.equal(((await response.json()) as { ok: boolean }).ok, false);
    assert.equal(provider.received.length, 0);
  });

  it('sends nothing when a post is saved or published', async () => {
    const { admin } = await site();
    const saved = await admin.post('/admin/posts/new', {
      title: 'Saved',
      body: 'Words.',
      action: 'publish',
    });
    assert.equal(saved.status, 303);
    assert.equal(provider.received.length, 0);
  });

  it('draws nothing and answers 404 while it is disabled', async () => {
    const { admin } = await site({ apiKey: KEY, enabled: false });
    assert.deepEqual(buttonsOn(await (await admin.get('/admin/posts/new')).text()), []);
    const response = await admin.post(actionUrl('suggest-title'), { type: 'post', body: 'x' });
    assert.equal(response.status, 404);
    assert.equal(provider.received.length, 0);
  });
});

describe('the words and the tidying', () => {
  it('has plain words for every failure kind', () => {
    const failures: LlmFailure[] = [
      { kind: 'unconfigured' },
      { kind: 'unauthorized' },
      { kind: 'no-credit' },
      { kind: 'rate-limited', retryAfter: 30 },
      { kind: 'rate-limited', retryAfter: undefined },
      { kind: 'unavailable', status: 503, message: undefined },
      { kind: 'rejected', status: 400, message: 'response_format' },
      { kind: 'invalid-output', reason: 'not JSON' },
      { kind: 'timeout', seconds: 60 },
      { kind: 'aborted' },
      { kind: 'network' },
    ];
    const words = failures.map(failureWords);
    assert.equal(new Set(words).size, words.length, 'each says something different');
    assert.match(failureWords({ kind: 'rate-limited', retryAfter: 30 }), /30 seconds/);
    assert.match(failureWords({ kind: 'rejected', status: 400, message: undefined }), /structured/);
    for (const text of words) assert.doesNotMatch(text, /undefined|\{|status \d/);
  });

  it('cuts a run-on description at a word when no sentence fits', () => {
    const fitted = fitDescription(`${'word '.repeat(80)}end.`);
    assert.ok(fitted.endsWith(' …'));
    assert.ok(fitted.split(' ').length <= DESCRIPTION_WORDS);
  });

  it('tidies a title to one line without quotes or a full stop', () => {
    assert.equal(cleanTitle('  "Bread,\n  Again."  '), 'Bread, Again');
    assert.equal(cleanTitle('Wait for it...'), 'Wait for it...');
  });
});

describe('the package', () => {
  it('names its requirement the same way in requires, the geekity field and its peers', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      geekity: { requires: Record<string, string> };
      peerDependencies: Record<string, string>;
    };
    assert.deepEqual(manifest.geekity.requires, summary.requires);
    for (const name of Object.keys(summary.requires ?? {})) {
      assert.ok(name in manifest.peerDependencies, `${name} is a peer dependency`);
    }
  });
});
