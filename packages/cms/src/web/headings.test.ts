/**
 * Every post's page has one top-level heading, and the headings under it step
 * down one level at a time (TASK-144). A post with a title is headed by it; a
 * note or a reply with none is headed by what it is, who wrote it and when,
 * hidden from sight so the note still opens on its words. Asserted over HTTP
 * against the packaged theme, because the markup is the behaviour.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const NOW = '2026-09-13T12:00:00Z';

function post(frontMatter: string[], body: string): string {
  return ['---', ...frontMatter, '---', '', body, ''].join('\n');
}

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'posts/article.md': post(
    ['title: On gardens', "date: '2026-09-10T09:00:00Z'", 'permalink: /2026/09/on-gardens/'],
    'The tomatoes came in late.\n\n## What went wrong\n\nThe rain.',
  ),
  'posts/note.md': post(
    ["date: '2026-09-11T09:00:00Z'", 'permalink: /2026/09/coffee/', 'author: Ada Lovelace'],
    'Coffee first, then the inbox.',
  ),
  'posts/reply.md': post(
    [
      "date: '2026-09-12T09:00:00Z'",
      'permalink: /2026/09/agreed/',
      'in-reply-to: https://them.example/2026/09/their-post/',
    ],
    'Completely agree with this.',
  ),
  '_data/comments/coffee.json': JSON.stringify({
    post: '/2026/09/coffee/',
    comments: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        source: 'comment',
        kind: 'reply',
        status: 'approved',
        author: { name: 'Grace Hopper', url: null, email: null, avatar: null },
        content: { markdown: 'Tea, surely.', html: '<p>Tea, surely.</p>' },
        submitted: '2026-09-11T10:00:00.000Z',
        addressHash: null,
        inReplyTo: null,
        url: null,
        notify: false,
      },
    ],
  }),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-headings-content-');
  const dataDir = await box.dir('geekity-headings-data-');
  for (const [relative, contents] of Object.entries(FILES)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  // The reply's target is not a public address, so fetching its context warns.
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    cms = await box.open({ contentDir, dataDir, now: () => new Date(NOW) });
  } finally {
    console.warn = warn;
  }
});

async function get(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

/** Every heading on the page, in document order, as its level and its whole tag. */
function headings(html: string): { level: number; markup: string }[] {
  return [...html.matchAll(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/g)].map((match) => ({
    level: Number(match[1]),
    markup: match[0],
  }));
}

/** The first heading level that jumps more than one below the one before it. */
function skipped(levels: number[]): string | undefined {
  let previous = 0;
  for (const level of levels) {
    if (level > previous + 1) return `h${String(previous)} then h${String(level)}`;
    previous = level;
  }
  return undefined;
}

const PAGES = {
  article: '/2026/09/on-gardens/',
  note: '/2026/09/coffee/',
  reply: '/2026/09/agreed/',
};

describe('the headings on a post’s page', () => {
  for (const [kind, url] of Object.entries(PAGES)) {
    it(`gives the ${kind} exactly one h1, and skips no level under it`, async () => {
      const found = headings(await get(url));
      const levels = found.map((heading) => heading.level);

      assert.equal(
        levels.filter((level) => level === 1).length,
        1,
        `h1s on ${url}: ${levels.join(',')}`,
      );
      assert.equal(levels[0], 1, `the first heading on ${url} is not the h1`);
      assert.equal(skipped(levels), undefined, `${url} skips a level`);
    });
  }

  it('checks the note under its conversation and its comment form', async () => {
    const markup = headings(await get(PAGES.note)).map((heading) => heading.markup);

    assert.ok(
      markup.some((h) => h.startsWith('<h2 class="comments-title">')),
      'no thread on the note',
    );
    assert.ok(
      markup.some((h) => h.startsWith('<h2 class="comment-reply-title">')),
      'no form on the note',
    );
  });

  it('heads an article with its title as its p-name, in sight', async () => {
    const [h1] = headings(await get(PAGES.article));

    assert.equal(h1?.markup, '<h1 class="p-name">On gardens</h1>');
  });

  it('heads a note with what it is, who wrote it and when, out of sight', async () => {
    const [h1] = headings(await get(PAGES.note));

    assert.equal(
      h1?.markup,
      '<h1 class="screen-reader-text">Note by Ada Lovelace, 11 September 2026</h1>',
    );
  });

  it('heads an untitled reply by nobody in particular as a reply, and when', async () => {
    const [h1] = headings(await get(PAGES.reply));

    assert.equal(h1?.markup, '<h1 class="screen-reader-text">Reply, 12 September 2026</h1>');
  });

  it('counts the note’s thread without quoting a title it does not have (TASK-186)', async () => {
    const markup = headings(await get(PAGES.note)).map((heading) => heading.markup);

    assert.ok(
      markup.includes('<h2 class="comments-title">One reply</h2>'),
      `the note's thread is not headed One reply: ${markup.join(' ')}`,
    );
  });

  it('gives an untitled post no name, so it is still a note to a parser', async () => {
    for (const url of [PAGES.note, PAGES.reply]) {
      assert.doesNotMatch(await get(url), /p-name[^>]*>\s*(Note|Reply) by/, `${url} names itself`);
    }
  });

  it('hides the heading with the stylesheet’s screen-reader-text rule', async () => {
    const css = await readFile(
      fileURLToPath(new URL('../../themes/default/static/style.css', import.meta.url)),
      'utf8',
    );
    const rule = /\.screen-reader-text \{([^}]*)\}/.exec(css)?.[1] ?? '';

    assert.match(rule, /position: absolute;/);
    assert.match(rule, /clip-path: inset\(50%\);/);
  });
});
