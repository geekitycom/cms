import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { arrangeColumns, changeLayout, dashboardLayout, EMPTY_LAYOUT } from './dashboard-layout.ts';
import type { DashboardLayout } from './dashboard-layout.ts';

const DEFAULTS = ['core:a', 'core:b', 'core:c', 'core:d'];

function columns(left: string[], right: string[]): DashboardLayout {
  return { ...EMPTY_LAYOUT, columns: [left, right] };
}

describe('dashboardLayout', () => {
  it('reads the columns and lists, and drops entries that are not strings', () => {
    assert.deepEqual(
      dashboardLayout({
        columns: [['core:b', 3, 'core:a'], ['core:d']],
        collapsed: ['core:c'],
        removed: 'x',
      }),
      { columns: [['core:b', 'core:a'], ['core:d']], collapsed: ['core:c'], removed: [] },
    );
  });

  it('keeps a key in only the first column that lists it', () => {
    assert.deepEqual(dashboardLayout({ columns: [['core:a'], ['core:a', 'core:b']] })?.columns, [
      ['core:a'],
      ['core:b'],
    ]);
  });

  it('reads an order saved before the columns as columns alternating in that order', () => {
    assert.deepEqual(
      dashboardLayout({ order: ['core:d', 'core:c', 'core:b', 'core:a'], removed: ['core:c'] }),
      {
        columns: [
          ['core:d', 'core:b'],
          ['core:c', 'core:a'],
        ],
        collapsed: [],
        removed: ['core:c'],
      },
    );
  });

  it('reads nothing usable as no layout', () => {
    assert.equal(dashboardLayout('nope'), undefined);
    assert.equal(dashboardLayout({ columns: [[], []], collapsed: [], removed: [] }), undefined);
    assert.equal(dashboardLayout({ order: [] }), undefined);
  });
});

describe('arrangeColumns', () => {
  it('alternates the default order left and right when nothing is saved', () => {
    assert.deepEqual(arrangeColumns(DEFAULTS, EMPTY_LAYOUT), [
      ['core:a', 'core:c'],
      ['core:b', 'core:d'],
    ]);
  });

  it('follows the saved columns', () => {
    assert.deepEqual(
      arrangeColumns(DEFAULTS, columns(['core:d', 'core:c', 'core:b'], ['core:a'])),
      [['core:d', 'core:c', 'core:b'], ['core:a']],
    );
  });

  it('puts a widget the columns do not mention at the end of the column with fewer cards', () => {
    assert.deepEqual(
      arrangeColumns(
        [...DEFAULTS, 'plugin:new'],
        columns(['core:a', 'core:b', 'core:c'], ['core:d']),
      ),
      [
        ['core:a', 'core:b', 'core:c'],
        ['core:d', 'plugin:new'],
      ],
    );
  });

  it('does not count removed cards when it picks the shorter column', () => {
    assert.deepEqual(
      arrangeColumns([...DEFAULTS, 'plugin:new'], {
        ...columns(['core:a', 'core:b'], ['core:c', 'core:d']),
        removed: ['core:a', 'core:b'],
      }),
      [
        ['core:a', 'core:b', 'plugin:new'],
        ['core:c', 'core:d'],
      ],
    );
  });

  it('ignores saved ids that no longer exist', () => {
    assert.deepEqual(
      arrangeColumns(
        DEFAULTS,
        columns(['gone:x', 'core:d', 'core:c'], ['gone:y', 'core:b', 'core:a']),
      ),
      [
        ['core:d', 'core:c'],
        ['core:b', 'core:a'],
      ],
    );
  });
});

describe('changeLayout', () => {
  it('collapses, expands, removes and adds back', () => {
    const collapsed = changeLayout(EMPTY_LAYOUT, { action: 'collapse', key: 'core:b' }, DEFAULTS);
    assert.deepEqual(collapsed.collapsed, ['core:b']);
    assert.deepEqual(
      changeLayout(collapsed, { action: 'expand', key: 'core:b' }, DEFAULTS).collapsed,
      [],
    );

    const removed = changeLayout(EMPTY_LAYOUT, { action: 'remove', key: 'core:c' }, DEFAULTS);
    assert.deepEqual(removed.removed, ['core:c']);
    assert.deepEqual(
      changeLayout(removed, { action: 'restore', key: 'core:c' }, DEFAULTS).removed,
      [],
    );
  });

  it('keeps every other card in its column when one is removed, and adds it back where it was', () => {
    const removed = changeLayout(EMPTY_LAYOUT, { action: 'remove', key: 'core:a' }, DEFAULTS);
    assert.deepEqual(arrangeColumns(DEFAULTS, removed), [
      ['core:a', 'core:c'],
      ['core:b', 'core:d'],
    ]);
    const back = changeLayout(removed, { action: 'restore', key: 'core:a' }, DEFAULTS);
    assert.deepEqual(arrangeColumns(DEFAULTS, back), [
      ['core:a', 'core:c'],
      ['core:b', 'core:d'],
    ]);
  });

  it('adds a card back to the shorter column when no column holds it', () => {
    const layout = { ...columns(['core:a', 'core:c'], ['core:b']), removed: ['core:d'] };
    const back = changeLayout(layout, { action: 'restore', key: 'core:d' }, DEFAULTS);
    assert.deepEqual(arrangeColumns(DEFAULTS, back), [
      ['core:a', 'core:c'],
      ['core:b', 'core:d'],
    ]);
  });

  it('moves a card up and down its own column, skipping removed cards', () => {
    const layout = {
      ...columns(['core:a', 'core:b', 'core:c'], ['core:d']),
      removed: ['core:b'],
    };
    const moved = changeLayout(layout, { action: 'later', key: 'core:a' }, DEFAULTS);
    assert.deepEqual(arrangeColumns(DEFAULTS, moved), [['core:b', 'core:c', 'core:a'], ['core:d']]);
    const back = changeLayout(moved, { action: 'earlier', key: 'core:a' }, DEFAULTS);
    assert.deepEqual(arrangeColumns(DEFAULTS, back), [['core:b', 'core:a', 'core:c'], ['core:d']]);
  });

  it('steps past only the cards the page drew', () => {
    const layout = columns(['core:a', 'core:b', 'core:c'], ['core:d']);
    const moved = changeLayout(
      layout,
      { action: 'later', key: 'core:a', cardsOnPage: ['core:a', 'core:c', 'core:d'] },
      DEFAULTS,
    );
    assert.deepEqual(arrangeColumns(DEFAULTS, moved), [['core:b', 'core:c', 'core:a'], ['core:d']]);
  });

  it('leaves the top card on top and the bottom card at the bottom of its column', () => {
    for (const change of [
      { action: 'earlier', key: 'core:a' },
      { action: 'later', key: 'core:c' },
      { action: 'earlier', key: 'core:b' },
      { action: 'later', key: 'core:d' },
    ] as const) {
      assert.deepEqual(arrangeColumns(DEFAULTS, changeLayout(EMPTY_LAYOUT, change, DEFAULTS)), [
        ['core:a', 'core:c'],
        ['core:b', 'core:d'],
      ]);
    }
  });

  it('moves a card to the other column at the same place among the drawn cards', () => {
    const layout = columns(['core:a', 'core:b'], ['core:c', 'core:d']);
    assert.deepEqual(
      arrangeColumns(DEFAULTS, changeLayout(layout, { action: 'right', key: 'core:b' }, DEFAULTS)),
      [['core:a'], ['core:c', 'core:b', 'core:d']],
    );
    assert.deepEqual(
      arrangeColumns(DEFAULTS, changeLayout(layout, { action: 'left', key: 'core:c' }, DEFAULTS)),
      [['core:c', 'core:a', 'core:b'], ['core:d']],
    );
  });

  it('moves a card to the end of the other column when it is lower than that column reaches', () => {
    const layout = columns(['core:a', 'core:b', 'core:c'], ['core:d']);
    assert.deepEqual(
      arrangeColumns(DEFAULTS, changeLayout(layout, { action: 'right', key: 'core:c' }, DEFAULTS)),
      [
        ['core:a', 'core:b'],
        ['core:d', 'core:c'],
      ],
    );
  });

  it('moves a card into an empty column', () => {
    const layout = columns(DEFAULTS, []);
    assert.deepEqual(
      arrangeColumns(DEFAULTS, changeLayout(layout, { action: 'right', key: 'core:b' }, DEFAULTS)),
      [['core:a', 'core:c', 'core:d'], ['core:b']],
    );
  });

  it('leaves a card where it is when it is already in the column it is sent to', () => {
    const layout = columns(['core:a', 'core:b'], ['core:c', 'core:d']);
    assert.deepEqual(
      arrangeColumns(DEFAULTS, changeLayout(layout, { action: 'left', key: 'core:a' }, DEFAULTS)),
      [
        ['core:a', 'core:b'],
        ['core:c', 'core:d'],
      ],
    );
  });

  it('takes both columns, as drag and drop sends them, and drops unknown keys', () => {
    const layout = changeLayout(
      EMPTY_LAYOUT,
      {
        action: 'order',
        columns: [
          ['core:c', 'nope'],
          ['core:a', 'core:b', 'core:d'],
        ],
      },
      DEFAULTS,
    );
    assert.deepEqual(arrangeColumns(DEFAULTS, layout), [
      ['core:c'],
      ['core:a', 'core:b', 'core:d'],
    ]);
  });

  it('keeps a card drag and drop did not send in its old column', () => {
    const layout = {
      ...columns(['core:a', 'core:b'], ['core:c', 'core:d']),
      removed: ['core:b'],
    };
    const moved = changeLayout(
      layout,
      { action: 'order', columns: [[], ['core:c', 'core:a', 'core:d']] },
      DEFAULTS,
    );
    assert.deepEqual(arrangeColumns(DEFAULTS, moved), [['core:b'], ['core:c', 'core:a', 'core:d']]);
  });

  it('ignores a key the dashboard does not have', () => {
    assert.deepEqual(
      changeLayout(EMPTY_LAYOUT, { action: 'remove', key: 'gone:x' }, DEFAULTS),
      EMPTY_LAYOUT,
    );
  });
});
