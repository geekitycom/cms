import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import type { SearchJson } from './search.ts';
import { searchHref, searchPageIndex, searchQuery, snippetHtml } from './search.ts';

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/**
 * A CMS over a content directory holding `files`, already synced, with its
 * clock stopped in September 2026 so a post dated after that is scheduled.
 */
async function site(files: Record<string, string>): Promise<Cms> {
  const contentDir = await temporaryDir('geekity-search-content-');
  const dataDir = await temporaryDir('geekity-search-data-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }

  const cms = createCms({
    contentDir,
    dataDir,
    watch: false,
    now: () => new Date('2026-09-15T00:00:00Z'),
  });
  started.push(cms);
  await cms.sync();
  return cms;
}

/** A post file, dated before the stopped clock unless `date` says otherwise. */
function post(
  title: string,
  permalink: string,
  body: string,
  options: { draft?: boolean; date?: string } = {},
): string {
  const date = options.date ?? '2026-09-01T09:00:00Z';
  const draft = options.draft === true ? 'draft: true\n' : '';
  return `---\ntitle: ${title}\ndate: '${date}'\npermalink: ${permalink}\n${draft}---\n\n${body}\n`;
}

/** A page file. */
function page(title: string, permalink: string, body: string): string {
  return `---\ntitle: ${title}\npermalink: ${permalink}\n---\n\n${body}\n`;
}

/** A site with something to find and every kind of thing that must not be found. */
function corpus(): Record<string, string> {
  return {
    'posts/in-title.md': post('Otters', '/otters/', 'A post about rivers.'),
    'posts/in-body.md': post('Rivers', '/rivers/', 'Where the otters swim, among other things.'),
    'pages/about.md': page('About', '/about/', 'I like otters.'),
    'posts/draft.md': post('Draft', '/draft/', 'Otters in a draft.', { draft: true }),
    '_trash/posts/gone.md': post('Gone', '/gone/', 'Otters in the trash.'),
    'posts/later.md': post('Later', '/later/', 'Otters next year.', {
      date: '2027-01-01T09:00:00Z',
    }),
  };
}

/** The titles of the results on an HTML page, in the order they are printed. */
function resultTitles(html: string): string[] {
  return [
    ...html.matchAll(/<article class="search-result[^"]*">[\s\S]*?class="u-url">([^<]*)</g),
  ].map((match) => match[1] as string);
}

describe('GET /search/', () => {
  it('lists the published posts and pages that match, best first (AC #1)', async () => {
    const cms = await site(corpus());

    const response = await cms.app.request('/search/?q=otters');
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const titles = resultTitles(html);
    assert.equal(titles[0], 'Otters', 'a title match is not ranked first');
    assert.deepEqual([...titles].sort(), ['About', 'Otters', 'Rivers']);
    assert.match(html, /3 results for &ldquo;otters&rdquo;/);
  });

  it('never returns a draft, a trashed post or a scheduled one (AC #3)', async () => {
    const cms = await site(corpus());

    const html = await (await cms.app.request('/search/?q=otters')).text();
    const json = (await (
      await cms.app.request('/search/?q=otters', { headers: { accept: 'application/json' } })
    ).json()) as SearchJson;

    for (const hidden of ['Draft', 'Gone', 'Later']) {
      assert.ok(!resultTitles(html).includes(hidden), `${hidden} is in the HTML results`);
      assert.ok(
        !json.results.some((result) => result.frontMatter['title'] === hidden),
        `${hidden} is in the JSON results`,
      );
    }
    assert.equal(json.pagination.total, 3);
  });

  it('answers JSON to a client that asks for it, and at /search/index.json', async () => {
    const cms = await site(corpus());

    for (const [url, headers] of [
      ['/search/?q=rivers', { accept: 'application/json' }],
      ['/search/index.json?q=rivers', {}],
    ] as const) {
      const response = await cms.app.request(url, { headers });
      assert.equal(response.status, 200, url);
      assert.match(response.headers.get('content-type') ?? '', /application\/json/, url);

      const json = (await response.json()) as SearchJson;
      assert.equal(json.schema, 1);
      assert.equal(json.query, 'rivers');
      assert.deepEqual(
        json.results.map((result) => result.url),
        ['http://localhost:3000/rivers/', 'http://localhost:3000/otters/'],
        url,
      );
      assert.match(json.results[0]?.snippet ?? '', /<mark>/);
      assert.equal(json.results[0]?.markdown, undefined, 'a summary carries the body');
    }
  });

  it('advertises the other representation with the query kept', async () => {
    const cms = await site(corpus());

    const html = await cms.app.request('/search/?q=otters');
    assert.match(
      html.headers.get('link') ?? '',
      /<\/search\/index\.json\?q=otters>; rel="alternate"; type="application\/json"/,
    );
    assert.equal(html.headers.get('vary'), 'Accept');
  });

  it('answers 406 to a client that accepts neither', async () => {
    const cms = await site(corpus());

    const response = await cms.app.request('/search/?q=otters', {
      headers: { accept: 'text/markdown' },
    });
    assert.equal(response.status, 406);
  });

  it('shows the form and nothing else before a search', async () => {
    const cms = await site(corpus());

    for (const url of ['/search/', '/search/?q=', '/search/?q=%20%22-%22']) {
      const response = await cms.app.request(url);
      const html = await response.text();
      assert.equal(response.status, 200, url);
      assert.match(html, /<form class="search-form"/, url);
      assert.deepEqual(resultTitles(html), [], url);
    }
  });

  it('says so when nothing matches', async () => {
    const cms = await site(corpus());

    const html = await (await cms.app.request('/search/?q=platypus')).text();
    assert.match(html, /Nothing found for &ldquo;platypus&rdquo;\./);
  });

  it('puts the query back in the box and escapes it everywhere it is printed', async () => {
    const cms = await site(corpus());

    const html = await (
      await cms.app.request(`/search/?q=${encodeURIComponent('<script>"x"</script>')}`)
    ).text();
    assert.doesNotMatch(html, /<script>"x"/);
    assert.match(html, /value="&lt;script&gt;&quot;x&quot;&lt;\/script&gt;"/);
  });

  it('marks the matched words and prints the rest of the snippet as text', async () => {
    const cms = await site({
      'posts/markup.md': post(
        'Markup',
        '/markup/',
        'Wrap a match in `<mark>` like an otter would.',
      ),
    });

    const html = await (await cms.app.request('/search/?q=otter')).text();
    assert.match(html, /&lt;mark&gt; like an <mark>otter<\/mark> would\./);
  });

  it('pages through the results and 404s past the last page', async () => {
    const cms = await site({
      '_data/site.json': JSON.stringify({ postsPerPage: 1 }),
      'posts/a.md': post('A', '/a/', 'shared word'),
      'posts/b.md': post('B', '/b/', 'shared word'),
    });

    const first = await (await cms.app.request('/search/?q=shared')).text();
    assert.equal(resultTitles(first).length, 1);
    assert.match(first, /rel="next" href="\/search\/\?q=shared&amp;page=2"/);

    const second = await cms.app.request('/search/?q=shared&page=2');
    assert.equal(second.status, 200);
    assert.equal(resultTitles(await second.text()).length, 1);

    assert.equal((await cms.app.request('/search/?q=shared&page=3')).status, 404);
    assert.equal((await cms.app.request('/search/?q=shared&page=0')).status, 404);
    assert.equal((await cms.app.request('/search/?q=shared&page=two')).status, 404);
  });

  it('redirects the path without its slash, keeping the query', async () => {
    const cms = await site(corpus());

    const response = await cms.app.request('/search?q=otters');
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/search/?q=otters');
  });

  it('asks not to be indexed', async () => {
    const cms = await site(corpus());

    const html = await (await cms.app.request('/search/?q=otters')).text();
    assert.match(html, /<meta name="robots" content="noindex">/);
  });

  it('follows the index: a post published after boot is found (AC #2)', async () => {
    const cms = await site(corpus());
    assert.equal(cms.store.countSearch('beavers'), 0);

    cms.store.upsert({
      ...(cms.store.getByPath('posts/in-title.md') as NonNullable<
        ReturnType<typeof cms.store.getByPath>
      >),
      html: '<p>Beavers too.</p>',
      hash: 'changed',
    });

    const html = await (await cms.app.request('/search/?q=beavers')).text();
    assert.deepEqual(resultTitles(html), ['Otters']);
  });
});

describe('the search box in the theme', () => {
  it('is in the footer of an ordinary page, but only once on the search page', async () => {
    const cms = await site(corpus());

    const home = await (await cms.app.request('/')).text();
    assert.match(
      home,
      /<footer>[\s\S]*<form class="search-form" role="search" action="\/search\/"/,
    );

    const results = await (await cms.app.request('/search/?q=otters')).text();
    assert.equal(results.match(/<form class="search-form"/g)?.length, 1);
  });

  it('is advertised to clients as a SearchAction', async () => {
    const cms = await site(corpus());

    const home = await (await cms.app.request('/')).text();
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(home)?.[1];
    const graph = (JSON.parse(json ?? '{}') as { '@graph': Record<string, unknown>[] })['@graph'];
    const website = graph.find((node) => node['@type'] === 'WebSite');

    assert.deepEqual(website?.['potentialAction'], {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'http://localhost:3000/search/?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    });
  });
});

describe('search URLs', () => {
  it('spell the first page without a number and the rest with one', () => {
    assert.equal(searchHref('', 0), '/search/');
    assert.equal(searchHref('a b', 0), '/search/?q=a+b');
    assert.equal(searchHref('a', 2), '/search/?q=a&page=3');
    assert.equal(searchHref('a', 0, 'json'), '/search/index.json?q=a');
  });

  it('read a page number one-based, and nothing that is not one', () => {
    assert.equal(searchPageIndex(undefined), 0);
    assert.equal(searchPageIndex('1'), 0);
    assert.equal(searchPageIndex('4'), 3);
    assert.equal(searchPageIndex('0'), undefined);
    assert.equal(searchPageIndex('-1'), undefined);
    assert.equal(searchPageIndex('2.5'), undefined);
  });

  it('trim the query and cut it short', () => {
    assert.equal(searchQuery('  hi  '), 'hi');
    assert.equal(searchQuery(undefined), '');
    assert.equal(searchQuery('x'.repeat(1000)).length, 256);
  });

  it('turn snippet marks into <mark> only after escaping', () => {
    assert.equal(snippetHtml('a <b> \u0002c\u0003 & d'), 'a &lt;b&gt; <mark>c</mark> &amp; d');
  });
});
