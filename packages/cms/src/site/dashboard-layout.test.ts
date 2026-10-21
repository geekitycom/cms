import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { arrangeCards, changeLayout, dashboardLayout, EMPTY_LAYOUT } from './dashboard-layout.ts';

const DEFAULTS = ['core:a', 'core:b', 'core:c', 'core:d'];

describe('dashboardLayout', () => {
  it('reads the three lists and drops entries that are not strings', () => {
    assert.deepEqual(
      dashboardLayout({ order: ['core:b', 3, 'core:a'], collapsed: ['core:c'], removed: 'x' }),
      { order: ['core:b', 'core:a'], collapsed: ['core:c'], removed: [] },
    );
  });

  it('reads nothing usable as no layout', () => {
    assert.equal(dashboardLayout('nope'), undefined);
    assert.equal(dashboardLayout({ order: [], collapsed: [], removed: [] }), undefined);
  });
});

describe('arrangeCards', () => {
  it('is the default order when nothing is saved', () => {
    assert.deepEqual(arrangeCards(DEFAULTS, EMPTY_LAYOUT), DEFAULTS);
  });

  it('follows the saved order', () => {
    assert.deepEqual(
      arrangeCards(DEFAULTS, { ...EMPTY_LAYOUT, order: ['core:d', 'core:c', 'core:b', 'core:a'] }),
      ['core:d', 'core:c', 'core:b', 'core:a'],
    );
  });

  it('puts a widget the order does not mention after the cards that come before it by default', () => {
    assert.deepEqual(
      arrangeCards([...DEFAULTS, 'plugin:new'], {
        ...EMPTY_LAYOUT,
        order: ['core:d', 'core:a', 'core:c', 'core:b'],
      }),
      ['core:d', 'core:a', 'core:c', 'core:b', 'plugin:new'],
    );
    assert.deepEqual(
      arrangeCards(['core:first', ...DEFAULTS], { ...EMPTY_LAYOUT, order: ['core:b', 'core:a'] }),
      ['core:first', 'core:b', 'core:a', 'core:c', 'core:d'],
    );
  });

  it('ignores saved ids that no longer exist', () => {
    assert.deepEqual(
      arrangeCards(DEFAULTS, {
        ...EMPTY_LAYOUT,
        order: ['gone:x', 'core:d', 'core:c', 'gone:y', 'core:b', 'core:a'],
      }),
      ['core:d', 'core:c', 'core:b', 'core:a'],
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

  it('moves a card past its visible neighbour, skipping removed cards', () => {
    const layout = changeLayout(EMPTY_LAYOUT, { action: 'remove', key: 'core:b' }, DEFAULTS);
    const moved = changeLayout(layout, { action: 'later', key: 'core:a' }, DEFAULTS);
    assert.deepEqual(arrangeCards(DEFAULTS, moved), ['core:b', 'core:c', 'core:a', 'core:d']);
    const back = changeLayout(moved, { action: 'earlier', key: 'core:a' }, DEFAULTS);
    assert.deepEqual(arrangeCards(DEFAULTS, back), ['core:b', 'core:a', 'core:c', 'core:d']);
  });

  it('leaves the first card first and the last card last', () => {
    assert.deepEqual(
      arrangeCards(
        DEFAULTS,
        changeLayout(EMPTY_LAYOUT, { action: 'earlier', key: 'core:a' }, DEFAULTS),
      ),
      DEFAULTS,
    );
    assert.deepEqual(
      arrangeCards(
        DEFAULTS,
        changeLayout(EMPTY_LAYOUT, { action: 'later', key: 'core:d' }, DEFAULTS),
      ),
      DEFAULTS,
    );
  });

  it('takes a whole order, as drag and drop sends it, and drops unknown keys', () => {
    const layout = changeLayout(
      EMPTY_LAYOUT,
      { action: 'order', keys: ['core:c', 'nope', 'core:a'] },
      DEFAULTS,
    );
    assert.deepEqual(layout.order, ['core:c', 'core:a']);
    assert.deepEqual(arrangeCards(DEFAULTS, layout), ['core:c', 'core:a', 'core:b', 'core:d']);
  });

  it('ignores a key the dashboard does not have', () => {
    assert.deepEqual(
      changeLayout(EMPTY_LAYOUT, { action: 'remove', key: 'gone:x' }, DEFAULTS),
      EMPTY_LAYOUT,
    );
  });
});
