import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

import { sandbox } from './__testing__/harness.ts';
import { listScreens } from './__testing__/list-screens.ts';
import type { ListScreen } from './__testing__/list-screens.ts';

/**
 * The screens that are tables of rows, in the DaisyUI admin (decision-30,
 * TASK-272): each table is the table macro's, filters are tabs, page links are
 * the pagination macro, and every state a row is in is a badge that prints its
 * word.
 */

const execFile = promisify(execFileCallback);

const box = sandbox();
after(() => box.cleanup());

/** The list screens over one seeded site, served by a child process with `GEEKITY_ADMIN=daisyui`. */
async function daisyuiScreens(): Promise<Record<ListScreen, string>> {
  const { stdout } = await execFile(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx'),
      path.join(import.meta.dirname, '__testing__', 'list-probe.ts'),
    ],
    { env: { ...process.env, GEEKITY_ADMIN: 'daisyui' }, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as Record<ListScreen, string>;
}

/** The screen itself: what is inside `<main>`. */
function screenOf(html: string): string {
  return /<main\b[\s\S]*<\/main>/.exec(html)?.[0] ?? '';
}

/** Markup as the words it reads as. */
function text(html: string): string {
  return html
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** The first cell of every body row of every table on the screen, as text, less
 *  the marks either admin prints beside a row's name. */
function firstCells(html: string): string[] {
  return [...screenOf(html).matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].flatMap(([, body]) =>
    [...(body ?? '').matchAll(/<tr\b[^>]*>\s*<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/g)].map(
      ([, cell]) =>
        text(
          (cell ?? '').replaceAll(/<span class="(?:admin-status|badge)\b[^"]*">[^<]*<\/span>/g, ''),
        ),
    ),
  );
}

/** Every badge on the screen: its words and the classes after `badge badge-sm`. */
function badges(html: string): { label: string; modifiers: string }[] {
  return [
    ...screenOf(html).matchAll(/<span class="badge badge-sm((?: [\w-]+)*)">([^<]*)<\/span>/g),
  ].map(([, modifiers, label]) => ({ label: label ?? '', modifiers: (modifiers ?? '').trim() }));
}

/** Every class token outside the admin bar, whose shadow root keeps classes of its own. */
function classesOutsideTheBar(html: string): string[] {
  const page = html.replace(/<geekity-admin-bar\b[\s\S]*<\/geekity-admin-bar>/, '');
  return [...page.matchAll(/\bclass="([^"]*)"/g)].flatMap(([, value]) =>
    (value ?? '').split(/\s+/).filter(Boolean),
  );
}

/** The tabs a screen draws: each link's words, and whether it is the current one. */
function tabs(html: string): { label: string; current: boolean }[] {
  const nav = /<nav class="tabs tabs-box" aria-label="[^"]+">([\s\S]*?)<\/nav>/.exec(html);
  assert.ok(nav, 'the filters are a labelled tabs nav');
  return [
    ...(nav[1] ?? '').matchAll(
      /<a class="tab( tab-active)?" href="[^"]*"( aria-current="page")?>([^<]*)<\/a>/g,
    ),
  ].map(([, active, current, label]) => {
    assert.equal(
      active !== undefined,
      current !== undefined,
      `${label} is marked for both eye and ear`,
    );
    return { label: (label ?? '').trim(), current: current !== undefined };
  });
}

const SCREENS: readonly ListScreen[] = [
  'posts',
  'postDrafts',
  'postTrash',
  'postsPageTwo',
  'pages',
  'tags',
  'categories',
  'users',
  'apps',
  'activity',
  'activityFailures',
  'activityEntry',
  'media',
  'followers',
  'syndication',
];

describe('the list screens', async () => {
  const [old, daisyui] = await Promise.all([listScreens(box), daisyuiScreens()]);

  for (const screen of SCREENS) {
    describe(screen, () => {
      if (screen !== 'syndication') {
        it('lists the same rows in both admins', () => {
          assert.deepEqual(firstCells(daisyui[screen]), firstCells(old[screen]));
          assert.ok(firstCells(old[screen]).length > 0, 'and there are rows to list');
        });
      }

      it('draws every table through the table macro, scrolling inside its wrapper, caption first (AC #1)', () => {
        const page = screenOf(daisyui[screen]);
        const opened = [...page.matchAll(/<table\b[^>]*>/g)];
        assert.ok(opened.length > 0, 'the screen has a table');
        const drawn = [
          ...page.matchAll(
            /<div class="max-w-full overflow-x-auto contain-inline-size">\s*<table class="table table-sm">\s*<caption class="sr-only">([^<]+)<\/caption>/g,
          ),
        ];
        assert.equal(drawn.length, opened.length, 'every table is the macro’s');
        for (const [, caption] of drawn) assert.notEqual(caption?.trim(), '');
      });

      it('carries no class of the old admin (AC #4)', () => {
        assert.deepEqual(
          classesOutsideTheBar(daisyui[screen]).filter((token) => token.startsWith('admin-')),
          [],
        );
      });
    });
  }

  it('lists every syndication target the file holds, the ignored one too', () => {
    assert.deepEqual(firstCells(daisyui.syndication), ['IndieNews', 'Nameless']);
  });

  it('draws the posts filters as tabs with the current one marked (AC #2)', () => {
    const labels = ['All', 'Published', 'Scheduled', 'Drafts', 'Trash'];
    for (const [screen, current] of [
      ['posts', 'All'],
      ['postDrafts', 'Drafts'],
      ['postTrash', 'Trash'],
      ['pages', 'All'],
    ] as const) {
      assert.deepEqual(
        tabs(daisyui[screen]),
        labels.map((label) => ({ label, current: label === current })),
        screen,
      );
    }
  });

  it('draws the app activity filters as tabs with their counts (AC #2)', () => {
    assert.deepEqual(tabs(daisyui.activity), [
      { label: 'All (2)', current: true },
      { label: 'Failures (1)', current: false },
    ]);
    assert.deepEqual(tabs(daisyui.activityFailures), [
      { label: 'All (2)', current: false },
      { label: 'Failures (1)', current: true },
    ]);
  });

  it('pages through posts with the pagination macro (AC #2)', () => {
    const join = (html: string): string =>
      /<nav aria-label="Pages">\s*<div class="join">([\s\S]*?)<\/div>\s*<\/nav>/.exec(html)?.[1] ??
      '';

    const first = join(daisyui.posts);
    assert.match(
      first,
      /<span class="join-item btn btn-sm btn-disabled" aria-disabled="true">Newer<\/span>/,
    );
    assert.match(first, /aria-current="page">Page 1<\/span>/);
    assert.match(
      first,
      /<a class="join-item btn btn-sm" rel="next" href="\/admin\/posts\?page=2">Older<\/a>/,
    );

    const second = join(daisyui.postsPageTwo);
    assert.match(
      second,
      /<a class="join-item btn btn-sm" rel="prev" href="\/admin\/posts">Newer<\/a>/,
    );
    assert.match(second, /aria-current="page">Page 2<\/span>/);
  });

  it('prints every state a row is in as a badge in its colour, the word and all (AC #3)', () => {
    const expected: Partial<Record<ListScreen, { label: string; modifiers: string }[]>> = {
      posts: [
        { label: 'Scheduled', modifiers: 'badge-info' },
        { label: 'Hidden', modifiers: 'badge-ghost' },
        { label: 'Draft', modifiers: 'badge-warning' },
        ...Array.from({ length: 22 }, () => ({ label: 'Published', modifiers: '' })),
      ],
      postTrash: [{ label: 'Trash', modifiers: 'badge-ghost' }],
      pages: [
        { label: 'Draft', modifiers: 'badge-warning' },
        { label: 'Published', modifiers: '' },
      ],
      activity: [{ label: 'Refused', modifiers: 'badge-error' }],
      activityEntry: [{ label: 'Refused', modifiers: 'badge-error' }],
      media: [
        { label: 'Missing', modifiers: 'badge-warning' },
        { label: 'Trash', modifiers: 'badge-ghost' },
      ],
      followers: [
        { label: 'Rejected', modifiers: 'badge-error' },
        { label: 'Waiting', modifiers: 'badge-warning' },
        { label: '1 failed', modifiers: 'badge-error' },
      ],
      syndication: [
        { label: 'Offered', modifiers: '' },
        { label: 'Ignored', modifiers: 'badge-error' },
      ],
    };
    for (const [screen, wanted] of Object.entries(expected)) {
      assert.deepEqual(badges(daisyui[screen as ListScreen]), wanted, screen);
    }
  });
});
