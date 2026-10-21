/**
 * How one user has arranged the dashboard's widget cards (TASK-469).
 *
 * Cards are named by key, `owner:id`, where the owner is `core` or a plugin's
 * package name. The layout holds only what the user changed: an order, and
 * the cards they collapsed or removed. A card the order does not mention is
 * drawn in its default position, and a key for a card that no longer exists
 * is ignored, so a new widget appears for everybody and a disabled plugin
 * breaks nothing.
 */
export interface DashboardLayout {
  /** Card keys in the order the user put them. May be partial or stale. */
  readonly order: readonly string[];
  /** Cards drawn as their title bar only, and not loaded. */
  readonly collapsed: readonly string[];
  /** Cards not drawn at all, and not loaded, until the user adds them back. */
  readonly removed: readonly string[];
}

export const EMPTY_LAYOUT: DashboardLayout = { order: [], collapsed: [], removed: [] };

export type LayoutChange =
  | { readonly action: 'collapse' | 'expand' | 'remove' | 'restore'; readonly key: string }
  | {
      readonly action: 'earlier' | 'later';
      readonly key: string;
      /**
       * The cards the page drew, when the form said: a card whose widget had
       * nothing to show is not a neighbour to step past.
       */
      readonly shown?: readonly string[];
    }
  | { readonly action: 'order'; readonly keys: readonly string[] };

export const LAYOUT_ACTIONS = [
  'collapse',
  'expand',
  'remove',
  'restore',
  'earlier',
  'later',
  'order',
] as const;

/** A stored layout as this version reads it, or `undefined` when it says nothing. */
export function dashboardLayout(value: unknown): DashboardLayout | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const layout = {
    order: keysFrom(record['order']),
    collapsed: keysFrom(record['collapsed']),
    removed: keysFrom(record['removed']),
  };
  return isEmpty(layout) ? undefined : layout;
}

export function isEmpty(layout: DashboardLayout): boolean {
  return layout.order.length + layout.collapsed.length + layout.removed.length === 0;
}

/**
 * Every card in `defaults`, in the user's order. A card the order does not
 * mention goes straight after the last of the cards that come before it in the
 * default order, or first when there are none, so a newly enabled plugin's
 * cards go at the end.
 */
export function arrangeCards(defaults: readonly string[], layout: DashboardLayout): string[] {
  const known = new Set(defaults);
  const arranged = [...new Set(layout.order)].filter((key) => known.has(key));
  const placed = new Set(arranged);
  defaults.forEach((key, index) => {
    if (placed.has(key)) return;
    const after = Math.max(
      -1,
      ...defaults.slice(0, index).map((earlier) => arranged.indexOf(earlier)),
    );
    arranged.splice(after + 1, 0, key);
    placed.add(key);
  });
  return arranged;
}

/** The layout after one change. A key the dashboard does not have changes nothing. */
export function changeLayout(
  layout: DashboardLayout,
  change: LayoutChange,
  defaults: readonly string[],
): DashboardLayout {
  if (change.action === 'order') {
    const known = new Set(defaults);
    return { ...layout, order: [...new Set(change.keys)].filter((key) => known.has(key)) };
  }
  const { key } = change;
  if (!defaults.includes(key)) return layout;
  switch (change.action) {
    case 'collapse':
      return { ...layout, collapsed: withKey(layout.collapsed, key) };
    case 'expand':
      return { ...layout, collapsed: withoutKey(layout.collapsed, key) };
    case 'remove':
      return { ...layout, removed: withKey(layout.removed, key) };
    case 'restore':
      return { ...layout, removed: withoutKey(layout.removed, key) };
    case 'earlier':
    case 'later':
      return {
        ...layout,
        order: stepPastDrawnNeighbour(arrangeCards(defaults, layout), layout, change, key),
      };
  }
}

function stepPastDrawnNeighbour(
  arranged: string[],
  layout: DashboardLayout,
  change: Extract<LayoutChange, { action: 'earlier' | 'later' }>,
  key: string,
): string[] {
  const direction = change.action;
  const drawn = arranged.filter(
    (each) =>
      !layout.removed.includes(each) &&
      (change.shown === undefined || each === key || change.shown.includes(each)),
  );
  const at = drawn.indexOf(key);
  const neighbour = drawn[direction === 'earlier' ? at - 1 : at + 1];
  if (neighbour === undefined) return arranged;
  const without = arranged.filter((each) => each !== key);
  const target = without.indexOf(neighbour);
  without.splice(direction === 'earlier' ? target : target + 1, 0, key);
  return without;
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
