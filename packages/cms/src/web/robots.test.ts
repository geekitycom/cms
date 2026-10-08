import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { robotsTxt } from './robots.ts';

/**
 * The robots file a site's settings describe (TASK-148): the rules a site adds,
 * the AI-crawler policy, the Content-Signal line, and the two lines the CMS
 * keeps whatever the settings say.
 */

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A synced CMS whose `site.json` is `siteJson`, holding one post at `/hello/`. */
async function site(siteJson: Record<string, unknown> = {}): Promise<Cms> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-robots-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-robots-data-'));
  temporaryDirs.push(contentDir, dataDir);

  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(path.join(contentDir, '_data', 'site.json'), JSON.stringify(siteJson), 'utf8');
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, 'posts', 'hello.md'),
    `---\ntitle: Hello\ndate: '2026-09-03T09:00:00Z'\npermalink: /hello/\n---\n\nBody.\n`,
    'utf8',
  );

  const instance = createCms({ contentDir, dataDir, watch: false, baseUrl: 'https://example.com' });
  started.push(instance);
  await instance.sync();
  return instance;
}

/** The served robots file. */
async function robots(cms: Cms): Promise<string> {
  const response = await cms.app.request('/robots.txt');
  assert.equal(response.status, 200);
  return response.text();
}

/**
 * The file as its groups: each blank-line-separated block, keyed by the
 * user agents it names, holding its other lines.
 */
function groups(body: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const block of body.trim().split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const agents = lines.filter((line) => /^User-agent:/i.test(line));
    if (agents.length === 0) continue;
    const rules = lines.filter((line) => !/^User-agent:/i.test(line));
    for (const agent of agents) found.set(agent.replace(/^User-agent:\s*/i, ''), rules);
  }
  return found;
}

const SITEMAP_LINE = 'Sitemap: https://example.com/sitemap.xml';

describe('rules a site adds to robots.txt (AC #1)', () => {
  it('serves the added groups, each still keeping crawlers out of the admin', async () => {
    const cms = await site({
      robotsRules: [
        'User-agent: Googlebot-Image',
        'Disallow: /media/private/',
        '',
        'User-agent: SlowBot',
        'Crawl-delay: 10',
      ],
    });

    const body = await robots(cms);
    const found = groups(body);

    assert.deepEqual(found.get('*'), ['Disallow: /admin/'], 'the CMS group is unchanged');
    // RFC 9309 gives a crawler the one group that names it, so a group without
    // the admin rule would let that crawler into the admin.
    assert.deepEqual(found.get('Googlebot-Image'), [
      'Disallow: /admin/',
      'Disallow: /media/private/',
    ]);
    assert.deepEqual(found.get('SlowBot'), ['Disallow: /admin/', 'Crawl-delay: 10']);
    assert.ok(body.endsWith(`${SITEMAP_LINE}\n`), 'the Sitemap line is still the last line');
  });

  it('drops a hand-edited line that is not a rule rather than publishing it', async () => {
    const cms = await site({
      robotsRules: ['Disallow: /orphan/', 'User-agent: Bot', 'Nonsense here', 'Allow: /admin/'],
    });

    const body = await robots(cms);
    assert.doesNotMatch(body, /orphan/, 'a rule above any User-agent line is not served');
    assert.doesNotMatch(body, /Nonsense/);
    assert.doesNotMatch(body, /^Allow: \/admin\//m, 'nothing may reopen the admin');
    assert.deepEqual(groups(body).get('Bot'), ['Disallow: /admin/']);
    assert.match(body, /^Sitemap: https:\/\/example\.com\/sitemap\.xml$/m);
  });

  it('does not repeat the admin rule in a group that already shuts everything', () => {
    const body = robotsTxt('https://example.com', {
      aiCrawlers: 'allow',
      contentSignal: {},
      rules: ['User-agent: Everything', 'Disallow: /'],
    });
    assert.deepEqual(groups(body).get('Everything'), ['Disallow: /']);
  });
});

describe('the AI-crawler policy (AC #2)', () => {
  it('writes no per-agent group when every crawler is allowed', async () => {
    const body = await robots(await site({ aiCrawlers: 'allow' }));
    assert.deepEqual([...groups(body).keys()], ['*']);
  });

  it('blocks the training crawlers and leaves the retrieval ones alone', async () => {
    const found = groups(await robots(await site({ aiCrawlers: 'block-training' })));

    for (const agent of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Applebot-Extended']) {
      assert.deepEqual(found.get(agent), ['Disallow: /'], `${agent} is blocked`);
    }
    for (const agent of ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot']) {
      assert.equal(found.has(agent), false, `${agent} still fetches what a reader asks about`);
    }
    assert.deepEqual(found.get('*'), ['Disallow: /admin/']);
  });

  it('blocks the retrieval crawlers too when the policy is block all', async () => {
    const found = groups(await robots(await site({ aiCrawlers: 'block-all' })));

    for (const agent of ['GPTBot', 'ClaudeBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot']) {
      assert.deepEqual(found.get(agent), ['Disallow: /'], `${agent} is blocked`);
    }
    assert.deepEqual(found.get('*'), ['Disallow: /admin/'], 'search engines are untouched');
  });
});

describe('Content-Signal (AC #3)', () => {
  it('is written in the documented syntax in the group every crawler reads', async () => {
    const cms = await site({
      contentSignalSearch: 'yes',
      contentSignalAiInput: 'yes',
      contentSignalAiTrain: 'no',
    });

    assert.deepEqual(groups(await robots(cms)).get('*'), [
      'Disallow: /admin/',
      'Content-Signal: search=yes, ai-input=yes, ai-train=no',
    ]);
  });

  it('names only the signals a site set, and is absent when it set none', async () => {
    const partial = await robots(await site({ contentSignalAiTrain: 'no' }));
    assert.match(partial, /^Content-Signal: ai-train=no$/m);

    const none = await robots(await site({}));
    assert.doesNotMatch(none, /Content-Signal/);
  });

  it('reaches a crawler a site gave its own group, unless that group says otherwise', async () => {
    const cms = await site({
      contentSignalAiTrain: 'no',
      robotsRules: [
        'User-agent: Mine',
        'Allow: /',
        '',
        'User-agent: Theirs',
        'Content-Signal: ai-train=yes',
      ],
    });

    const found = groups(await robots(cms));
    assert.deepEqual(found.get('Mine'), [
      'Disallow: /admin/',
      'Allow: /',
      'Content-Signal: ai-train=no',
    ]);
    assert.deepEqual(found.get('Theirs'), ['Disallow: /admin/', 'Content-Signal: ai-train=yes']);
  });
});

describe('the Markdown and JSON alternates of a page (AC #4)', () => {
  it('ask search engines not to index them, and the HTML does not', async () => {
    const cms = await site();

    for (const url of ['/hello/index.md', '/hello/index.json']) {
      const response = await cms.app.request(url);
      assert.equal(response.status, 200, url);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex', url);
    }

    const negotiated = await cms.app.request('/hello/', { headers: { accept: 'text/markdown' } });
    assert.equal(negotiated.headers.get('x-robots-tag'), 'noindex', 'by Accept as well');

    const html = await cms.app.request('/hello/');
    assert.equal(html.status, 200);
    assert.equal(html.headers.get('x-robots-tag'), null);
  });
});
