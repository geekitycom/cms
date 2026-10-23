/**
 * The decisions behind the editor's distraction-free mode (decision-62), kept
 * apart from the DOM so they can be tested without one. `editor/focus.ts` is
 * the page side.
 */

/**
 * Where the mode is. `asked` is waiting on the browser's answer to a
 * fullscreen request; `window` fills the window instead, because fullscreen
 * was refused or is not available.
 */
export type FocusState =
  { readonly on: false } | { readonly on: true; readonly fullscreen: 'asked' | 'on' | 'window' };

export const FOCUS_OFF: FocusState = { on: false };

export type FocusEvent =
  | {
      readonly type: 'button' | 'shortcut';
      /** An offer of unsaved changes is waiting for Restore or Discard. */
      readonly blocked: boolean;
      readonly canFullscreen: boolean;
    }
  | { readonly type: 'escape' | 'exit' }
  | { readonly type: 'fullscreen-on' | 'fullscreen-off' | 'fullscreen-refused' };

export type FocusEffect =
  'enter' | 'leave' | 'request-fullscreen' | 'exit-fullscreen' | 'explain-blocked';

export interface FocusStep {
  readonly state: FocusState;
  readonly effects: readonly FocusEffect[];
}

export function focusStep(state: FocusState, event: FocusEvent): FocusStep {
  const still: FocusStep = { state, effects: [] };
  switch (event.type) {
    case 'button':
    case 'shortcut':
      if (state.on) return event.type === 'shortcut' ? leave(state) : still;
      if (event.blocked) return { state, effects: ['explain-blocked'] };
      return event.canFullscreen
        ? { state: { on: true, fullscreen: 'asked' }, effects: ['enter', 'request-fullscreen'] }
        : { state: { on: true, fullscreen: 'window' }, effects: ['enter'] };
    case 'escape':
    case 'exit':
      return state.on ? leave(state) : still;
    case 'fullscreen-on':
      return state.on
        ? { state: { on: true, fullscreen: 'on' }, effects: [] }
        : { state, effects: ['exit-fullscreen'] };
    case 'fullscreen-refused':
      return state.on ? { state: { on: true, fullscreen: 'window' }, effects: [] } : still;
    case 'fullscreen-off':
      return state.on && state.fullscreen === 'on'
        ? { state: FOCUS_OFF, effects: ['leave'] }
        : still;
  }
}

function leave(state: FocusState & { on: true }): FocusStep {
  return {
    state: FOCUS_OFF,
    effects: state.fullscreen === 'window' ? ['leave'] : ['leave', 'exit-fullscreen'],
  };
}

/** The parts of a `KeyboardEvent` the shortcut is read from. */
export interface KeyPress {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** Ctrl+Shift+F, or Cmd+Shift+F, by the key's place as well as its letter. */
export function isFocusShortcut(press: KeyPress): boolean {
  return (
    (press.ctrlKey || press.metaKey) &&
    press.shiftKey &&
    !press.altKey &&
    (press.key.toLowerCase() === 'f' || press.code === 'KeyF')
  );
}

/** Whitespace-separated runs with a letter or a digit in them, so `#`, `-` and `---` are not words. */
export function wordCount(text: string): number {
  let count = 0;
  for (const run of text.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(run)) count += 1;
  return count;
}

export function wordsLabel(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'word' : 'words'}`;
}

export interface Tree<T> {
  readonly parentOf: (node: T) => T | null;
  readonly childrenOf: (node: T) => readonly T[];
}

/**
 * Everything under `root` that has to be hidden for only `kept` to be left:
 * each sibling met on the way from a kept node up to the root. Nothing inside
 * a kept node is touched, and nothing inside a hidden one needs to be.
 */
export function outsideOf<T>(root: T, kept: readonly T[], tree: Tree<T>): T[] {
  const onPath = new Set<T>();
  for (const node of kept) {
    const path: T[] = [];
    let at: T | null = node;
    while (at !== null && at !== root) {
      path.push(at);
      at = tree.parentOf(at);
    }
    if (at === null) continue;
    if (node === root) return [];
    for (const step of path) onPath.add(step);
  }

  const hidden: T[] = [];
  const keptSet = new Set(kept);
  const walk = (parent: T): void => {
    for (const child of tree.childrenOf(parent)) {
      if (!onPath.has(child)) hidden.push(child);
      else if (!keptSet.has(child)) walk(child);
    }
  };
  if (onPath.size > 0) walk(root);
  return hidden;
}
