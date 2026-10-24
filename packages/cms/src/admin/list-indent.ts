/**
 * A nested item belongs to the item above only when it starts at that item's
 * text column: two spaces under `- `, three under `1. `. A fixed indent unit
 * gets ordered lists wrong, so the indent is read off the neighbouring items.
 */

export type Direction = 'in' | 'out';

/** Spaces to add to (or, when negative, take from) the start of a line. */
export interface LineShift {
  /** Zero-based line index. */
  line: number;
  shift: number;
}

interface Item {
  indent: number;
  textColumn: number;
}

const ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)/;

/**
 * The shifts that nest the selected lines under the item above, or bring them
 * back out to their parent's indent, as one block. `undefined` when the first
 * selected line is not a list item, so the caller can indent it as plain text.
 */
export function listIndent(
  lines: readonly string[],
  first: number,
  last: number,
  direction: Direction,
): LineShift[] | undefined {
  const start = lines[first];
  if (start === undefined) return undefined;
  const item = itemAt(start);
  if (item === undefined) return undefined;

  const target = direction === 'in' ? nestUnder(lines, first, item) : outdentTo(lines, first, item);
  const shift = target - item.indent;
  if (shift === 0) return [];

  const shifts: LineShift[] = [];
  for (let line = first; line <= last; line += 1) {
    const text = lines[line] ?? '';
    if (text.trim() === '') continue;
    shifts.push({ line, shift: Math.max(shift, -leadingSpaces(text)) });
  }
  return shifts;
}

function nestUnder(lines: readonly string[], first: number, item: Item): number {
  for (let line = first - 1; line >= 0; line -= 1) {
    const text = lines[line] ?? '';
    if (text.trim() === '') continue;
    const indent = leadingSpaces(text);
    if (indent > item.indent) continue;
    const above = itemAt(text);
    if (above === undefined || above.indent < item.indent) return item.indent;
    return above.textColumn;
  }
  return item.indent;
}

function outdentTo(lines: readonly string[], first: number, item: Item): number {
  for (let line = first - 1; line >= 0; line -= 1) {
    const text = lines[line] ?? '';
    if (text.trim() === '') continue;
    const indent = leadingSpaces(text);
    if (indent >= item.indent) continue;
    const above = itemAt(text);
    if (above === undefined) return 0;
    return above.indent;
  }
  return 0;
}

function itemAt(text: string): Item | undefined {
  const match = ITEM.exec(text);
  if (match === null) return undefined;
  const [whole, spaces = '', marker = ''] = match;
  const gap = whole.length - spaces.length - marker.length;
  return { indent: spaces.length, textColumn: spaces.length + marker.length + Math.max(gap, 1) };
}

function leadingSpaces(text: string): number {
  return text.length - text.trimStart().length;
}
