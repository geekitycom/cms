import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { sandbox } from './__testing__/harness.ts';
import { listScreens } from './__testing__/list-screens.ts';
import type { ListScreen } from './__testing__/list-screens.ts';
import { classesOutsideTheBar, pagination, screenOf, tabs, text } from './__testing__/markup.ts';

const box = sandbox();
after(() => box.cleanup());

/** The first cell of every body row of every table on the screen, as text, less
 *  the badges printed beside a row's name. */
function firstCells(html: string): string[] {
  return [...screenOf(html).matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].flatMap(([, body]) =>
    [...(body ?? '').matchAll(/<tr\b[^>]*>\s*<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/g)].map(
      ([, cell]) => text((cell ?? '').replaceAll(/<span class="badge\b[^"]*">[^<]*<\/span>/g, '')),
    ),
  );
}

/** Every badge on the screen: its words and the classes after `badge badge-sm`. */
function badges(html: string): { label: string; modifiers: string }[] {
  return [
    ...screenOf(html).matchAll(/<span class="badge badge-sm((?: [\w-]+)*)">([^<]*)<\/span>/g),
  ].map(([, modifiers, label]) => ({ label: label ?? '', modifiers: (modifiers ?? '').trim() }));
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
  const served = await listScreens(box);

  for (const screen of SCREENS) {
    describe(screen, () => {
      it('lists rows', () => {
        assert.ok(firstCells(served[screen]).length > 0);
      });

      it('draws every table through the table macro, scrolling inside its wrapper, caption first (AC #1)', () => {
        const page = screenOf(served[screen]);
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

      it('carries no admin-* class outside the bar (AC #4)', () => {
        assert.deepEqual(
          classesOutsideTheBar(served[screen]).filter((token) => token.startsWith('admin-')),
          [],
        );
      });
    });
  }

  it('lists every syndication target the file holds, the ignored one too', () => {
    assert.deepEqual(firstCells(served.syndication), ['IndieNews', 'Nameless']);
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
        tabs(served[screen]),
        labels.map((label) => ({ label, current: label === current })),
        screen,
      );
    }
  });

  it('draws the app activity filters as tabs with their counts (AC #2)', () => {
    assert.deepEqual(tabs(served.activity), [
      { label: 'All (2)', current: true },
      { label: 'Failures (1)', current: false },
    ]);
    assert.deepEqual(tabs(served.activityFailures), [
      { label: 'All (2)', current: false },
      { label: 'Failures (1)', current: true },
    ]);
  });

  it('pages through posts with the pagination macro (AC #2)', () => {
    const first = pagination(served.posts);
    assert.match(
      first,
      /<span class="join-item btn btn-sm btn-disabled" aria-disabled="true">Newer<\/span>/,
    );
    assert.match(first, /aria-current="page">Page 1<\/span>/);
    assert.match(
      first,
      /<a class="join-item btn btn-sm" rel="next" href="\/admin\/posts\?page=2">Older<\/a>/,
    );

    const second = pagination(served.postsPageTwo);
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
      assert.deepEqual(badges(served[screen as ListScreen]), wanted, screen);
    }
  });
});
