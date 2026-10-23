export type FocusState =
  | { readonly on: false }
  | { readonly on: true; readonly fullscreen: 'requested' | 'on' | 'filling-window' };

export const FOCUS_OFF: FocusState = { on: false };

export type FocusEvent =
  | {
      readonly type: 'button' | 'shortcut';
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
        ? { state: { on: true, fullscreen: 'requested' }, effects: ['enter', 'request-fullscreen'] }
        : { state: { on: true, fullscreen: 'filling-window' }, effects: ['enter'] };
    case 'escape':
    case 'exit':
      return state.on ? leave(state) : still;
    case 'fullscreen-on':
      return state.on
        ? { state: { on: true, fullscreen: 'on' }, effects: [] }
        : { state, effects: ['exit-fullscreen'] };
    case 'fullscreen-refused':
      return state.on ? { state: { on: true, fullscreen: 'filling-window' }, effects: [] } : still;
    case 'fullscreen-off':
      return state.on && state.fullscreen === 'on'
        ? { state: FOCUS_OFF, effects: ['leave'] }
        : still;
  }
}

function leave(state: FocusState & { on: true }): FocusStep {
  return {
    state: FOCUS_OFF,
    effects: state.fullscreen === 'filling-window' ? ['leave'] : ['leave', 'exit-fullscreen'],
  };
}

export interface KeyPress {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export function isFocusShortcut(press: KeyPress): boolean {
  return (
    (press.ctrlKey || press.metaKey) &&
    press.shiftKey &&
    !press.altKey &&
    (press.key.toLowerCase() === 'f' || press.code === 'KeyF')
  );
}

export interface Tree<T> {
  readonly parentOf: (node: T) => T | null;
  readonly childrenOf: (node: T) => readonly T[];
}

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
