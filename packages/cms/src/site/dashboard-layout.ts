/**
 * How one user has arranged the dashboard's widget cards (TASK-469, TASK-479).
 *
 * Cards are named by key, `owner:id`, where the owner is `core` or a plugin's
 * package name. The dashboard is two columns, each a stack of cards. The
 * layout holds what the user changed: the cards in each column, and the cards
 * they collapsed or removed. A card no column mentions goes at the end of the
 * column with fewer cards, and a key for a card that no longer exists is
 * ignored, so a new widget appears for everybody and a disabled plugin breaks
 * nothing.
 */
export interface DashboardLayout {
  /** Card keys in the left and right columns, top to bottom. May be partial or stale. */
  readonly columns: Columns;
  /** Cards drawn as their title bar only, and not loaded. */
  readonly collapsed: readonly string[];
  /** Cards not drawn at all, and not loaded, until the user adds them back. */
  readonly removed: readonly string[];
}

export type Columns = readonly [readonly string[], readonly string[]];

export const EMPTY_LAYOUT: DashboardLayout = { columns: [[], []], collapsed: [], removed: [] };

export type LayoutChange =
  | { readonly action: 'collapse' | 'expand' | 'remove' | 'restore'; readonly key: string }
  | Move
  | { readonly action: 'order'; readonly columns: Columns };

interface Move {
  readonly action: 'earlier' | 'later' | 'left' | 'right';
  readonly key: string;
  /**
   * The cards the page drew, when the form said: a card whose widget had
   * nothing to show is not a neighbour to step past.
   */
  readonly shown?: readonly string[];
}

export const LAYOUT_ACTIONS = [
  'collapse',
  'expand',
  'remove',
  'restore',
  'earlier',
  'later',
  'left',
  'right',
  'order',
] as const;

/**
 * A stored layout as this version reads it, or `undefined` when it says
 * nothing. A layout saved before the columns holds one `order`; it is read as
 * columns that alternate left and right in that order.
 */
export function dashboardLayout(value: unknown): DashboardLayout | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const layout = {
    columns: Array.isArray(record['columns'])
      ? distinct([keysFrom(record['columns'][0]), keysFrom(record['columns'][1])])
      : alternate(keysFrom(record['order'])),
    collapsed: keysFrom(record['collapsed']),
    removed: keysFrom(record['removed']),
  };
  return isEmpty(layout) ? undefined : layout;
}

export function isEmpty(layout: DashboardLayout): boolean {
  return (
    layout.columns[0].length +
      layout.columns[1].length +
      layout.collapsed.length +
      layout.removed.length ===
    0
  );
}

/**
 * Every card in `defaults`, in its column. A card no column mentions goes at
 * the end of the column with fewer cards drawn, the left one on a tie, so with
 * nothing saved the default order alternates left and right.
 */
export function arrangeColumns(defaults: readonly string[], layout: DashboardLayout): Columns {
  const known = new Set(defaults);
  const left = layout.columns[0].filter((key) => known.has(key));
  const right = layout.columns[1].filter((key) => known.has(key));
  const drawn = (column: string[]) => column.filter((key) => !layout.removed.includes(key)).length;
  for (const key of defaults) {
    if (left.includes(key) || right.includes(key)) continue;
    (drawn(right) < drawn(left) ? right : left).push(key);
  }
  return [left, right];
}

/**
 * The layout after one change. The columns are saved as they are drawn
 * first, so a later change never moves a card the user did not touch. A key
 * the dashboard does not have changes nothing.
 */
export function changeLayout(
  layout: DashboardLayout,
  change: LayoutChange,
  defaults: readonly string[],
): DashboardLayout {
  const columns = arrangeColumns(defaults, layout);
  if (change.action === 'order') {
    return { ...layout, columns: keepUnsent(columns, change.columns, defaults) };
  }
  const { key } = change;
  if (!defaults.includes(key)) return layout;
  const placed = { ...layout, columns };
  switch (change.action) {
    case 'collapse':
      return { ...placed, collapsed: withKey(layout.collapsed, key) };
    case 'expand':
      return { ...placed, collapsed: withoutKey(layout.collapsed, key) };
    case 'remove':
      return { ...placed, removed: withKey(layout.removed, key) };
    case 'restore':
      return { ...placed, removed: withoutKey(layout.removed, key) };
    case 'earlier':
    case 'later':
      return { ...placed, columns: stepPastDrawnNeighbour(placed, change) };
    case 'left':
    case 'right':
      return { ...placed, columns: moveAcross(placed, change) };
  }
}

function stepPastDrawnNeighbour(layout: DashboardLayout, change: Move): Columns {
  const { key } = change;
  const side = layout.columns[0].includes(key) ? 0 : 1;
  const column = layout.columns[side];
  const drawn = drawnIn(column, layout, change);
  const at = drawn.indexOf(key);
  const neighbour = drawn[change.action === 'earlier' ? at - 1 : at + 1];
  if (neighbour === undefined) return layout.columns;
  const without = column.filter((each) => each !== key);
  const target = without.indexOf(neighbour);
  without.splice(change.action === 'earlier' ? target : target + 1, 0, key);
  return withColumn(layout.columns, side, without);
}

/**
 * The card goes to the other column at the same place among the drawn cards,
 * above the card drawn there, or at the end when that column is shorter.
 */
function moveAcross(layout: DashboardLayout, change: Move): Columns {
  const { key } = change;
  const to = change.action === 'left' ? 0 : 1;
  const from = to === 0 ? 1 : 0;
  if (!layout.columns[from].includes(key)) return layout.columns;
  const at = drawnIn(layout.columns[from], layout, change).indexOf(key);
  const target = [...layout.columns[to]];
  const below = drawnIn(target, layout, change)[at];
  target.splice(below === undefined ? target.length : target.indexOf(below), 0, key);
  const source = layout.columns[from].filter((each) => each !== key);
  return to === 0 ? [target, source] : [source, target];
}

function drawnIn(column: readonly string[], layout: DashboardLayout, change: Move): string[] {
  return column.filter(
    (each) =>
      !layout.removed.includes(each) &&
      (change.shown === undefined || each === change.key || change.shown.includes(each)),
  );
}

/**
 * Drag and drop sends only the cards the page drew. A card it did not send,
 * such as a removed one, stays at the end of the column it was in.
 */
function keepUnsent(before: Columns, sent: Columns, defaults: readonly string[]): Columns {
  const [left, right] = distinct(sent).map((column) =>
    column.filter((key) => defaults.includes(key)),
  ) as [string[], string[]];
  const unsent = (side: 0 | 1) =>
    before[side].filter((key) => !left.includes(key) && !right.includes(key));
  return [
    [...left, ...unsent(0)],
    [...right, ...unsent(1)],
  ];
}

function withColumn(columns: Columns, side: 0 | 1, column: string[]): Columns {
  return side === 0 ? [column, columns[1]] : [columns[0], column];
}

function alternate(order: readonly string[]): Columns {
  return [order.filter((_, index) => index % 2 === 0), order.filter((_, index) => index % 2 === 1)];
}

function distinct(columns: Columns): Columns {
  const left = [...new Set(columns[0])];
  return [left, [...new Set(columns[1])].filter((key) => !left.includes(key))];
}

function withKey(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? [...keys] : [...keys, key];
}

function withoutKey(keys: readonly string[], key: string): string[] {
  return keys.filter((each) => each !== key);
}

function keysFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((key): key is string => typeof key === 'string' && key !== ''))];
}
