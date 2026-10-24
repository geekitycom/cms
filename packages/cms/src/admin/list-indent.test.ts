import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Direction, listIndent } from './list-indent.ts';

function pressed(
  doc: string,
  first: number,
  direction: Direction,
  last = first,
): string | undefined {
  const lines = doc.split('\n');
  const shifts = listIndent(lines, first, last, direction);
  if (shifts === undefined) return undefined;
  for (const { line, shift } of shifts) {
    const text = lines[line] ?? '';
    lines[line] = shift > 0 ? ' '.repeat(shift) + text : text.slice(-shift);
  }
  return lines.join('\n');
}

describe('listIndent', () => {
  it('nests a bullet under the bullet above at its text column', () => {
    assert.equal(pressed('- one\n- two', 1, 'in'), '- one\n  - two');
  });

  it('nests an ordered item three spaces in, under the text of `1. `', () => {
    assert.equal(pressed('1. one\n2. two', 1, 'in'), '1. one\n   2. two');
  });

  it('follows a wider gap after the marker', () => {
    assert.equal(pressed('-   one\n-   two', 1, 'in'), '-   one\n    -   two');
  });

  it('nests under the nearest sibling, past that sibling’s own children', () => {
    assert.equal(
      pressed('- one\n  - child\n- two\n  - deep\n- three', 4, 'in'),
      '- one\n  - child\n- two\n  - deep\n  - three',
    );
  });

  it('nests a third level under a second-level sibling', () => {
    assert.equal(pressed('- one\n  - two\n  - three', 2, 'in'), '- one\n  - two\n    - three');
  });

  it('leaves the first item of a list where it is', () => {
    assert.equal(pressed('Intro.\n\n- one', 2, 'in'), 'Intro.\n\n- one');
  });

  it('leaves an item that is already the first child of the item above', () => {
    assert.equal(pressed('- one\n  - two', 1, 'in'), '- one\n  - two');
  });

  it('brings a nested item back out to its parent’s indent', () => {
    assert.equal(pressed('1. one\n   - two', 1, 'out'), '1. one\n- two');
  });

  it('brings a third-level item out one level, not to the margin', () => {
    assert.equal(pressed('- one\n  - two\n    - three', 2, 'out'), '- one\n  - two\n  - three');
  });

  it('does nothing to a top-level item on Shift-Tab', () => {
    assert.equal(pressed('- one\n- two', 1, 'out'), '- one\n- two');
  });

  it('moves a selected item and its children together, keeping their indents', () => {
    assert.equal(
      pressed('- one\n- two\n  - child\n\n  more', 1, 'in', 4),
      '- one\n  - two\n    - child\n\n    more',
    );
    assert.equal(pressed('- one\n  - two\n    - child', 1, 'out', 2), '- one\n- two\n  - child');
  });

  it('takes no more than a line has when a selection dedents', () => {
    assert.equal(pressed('- one\n  - two\n lazy', 1, 'out', 2), '- one\n- two\nlazy');
  });

  it('answers undefined for a line that is not a list item', () => {
    assert.equal(pressed('Some text.', 0, 'in'), undefined);
    assert.equal(pressed('- one\n\nA paragraph.', 2, 'out'), undefined);
  });

  it('counts a bare marker as an item', () => {
    assert.equal(pressed('- one\n-', 1, 'in'), '- one\n  -');
  });
});
