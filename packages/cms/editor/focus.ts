import type { EditorView } from 'codemirror';

import {
  FOCUS_OFF,
  focusStep,
  isFocusShortcut,
  outsideOf,
  wordsLabel,
} from '../src/admin/focus-mode.ts';
import type { FocusEffect, FocusEvent, FocusState } from '../src/admin/focus-mode.ts';
import { wordCount } from '../src/content/words.ts';
import { AUTOSAVE_STATUS_ID } from './autosave.ts';
import { LOOK } from './look.ts';
import { RESUME_ID } from './resume.ts';

const ON = 'editor-focus';

export interface FocusOptions {
  readonly view: EditorView;
  readonly form: HTMLFormElement;
  readonly surface: HTMLElement;
  readonly write: () => void;
  readonly say: (message: string, tone?: 'news' | 'error') => void;
}

export interface FocusMode {
  readonly button: HTMLButtonElement;
  readonly changed: (doc: EditorView['state']['doc']) => void;
}

export function focusMode(options: FocusOptions): FocusMode | undefined {
  const { view, form, surface } = options;
  const layout = layoutAround(surface);
  if (layout === undefined) return undefined;
  const { sheet, column, bodyField } = layout;
  const title = form.elements.namedItem('title');
  const titleField =
    title instanceof HTMLInputElement ? title.closest<HTMLElement>('.fieldset') : null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = LOOK.focusButton;
  button.textContent = 'Write in focus';
  button.title = 'Ctrl+Shift+F, or ⌘⇧F on a Mac';
  button.setAttribute('aria-keyshortcuts', 'Control+Shift+F Meta+Shift+F');

  const count = document.createElement('span');
  count.className = LOOK.focusCount;

  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = LOOK.focusExit;
  exit.textContent = 'Exit focus';
  exit.setAttribute('aria-keyshortcuts', 'Escape');

  const bar = document.createElement('div');
  bar.className = LOOK.focusBar;
  bar.hidden = true;
  bar.append(count, exit);
  column.append(bar);

  let state: FocusState = FOCUS_OFF;
  let returnTo: HTMLElement = button;
  let scroll = { x: 0, y: 0 };
  let hidden: HTMLElement[] = [];
  let styled: { element: HTMLElement; added: string[] }[] = [];
  let status: { element: HTMLElement; parent: Node; next: Node | null } | undefined;

  button.addEventListener('click', () => {
    dispatch({ type: 'button', ...room() });
  });
  exit.addEventListener('click', () => {
    dispatch({ type: 'exit' });
  });
  // Captured, and kept from CodeMirror: on a Mac its Emacs-style keys read
  // Ctrl+Shift+F as select the next character.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.isComposing || !isFocusShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: 'shortcut', ...room() });
    },
    { capture: true },
  );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.on && !event.defaultPrevented && !event.isComposing) {
      // CodeMirror takes Escape first to close its search panel or a
      // completion, and says so with preventDefault.
      event.preventDefault();
      dispatch({ type: 'escape' });
    }
  });
  document.addEventListener('fullscreenchange', () => {
    dispatch({ type: document.fullscreenElement === null ? 'fullscreen-off' : 'fullscreen-on' });
  });

  function room(): { blocked: boolean; canFullscreen: boolean } {
    return {
      blocked: document.getElementById(RESUME_ID) !== null,
      canFullscreen: document.fullscreenEnabled && 'requestFullscreen' in document.documentElement,
    };
  }

  function dispatch(event: FocusEvent): void {
    const step = focusStep(state, event);
    state = step.state;
    for (const effect of step.effects) run(effect);
  }

  function run(effect: FocusEffect): void {
    switch (effect) {
      case 'enter':
        enter();
        return;
      case 'leave':
        leave();
        return;
      case 'request-fullscreen':
        document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(
          () => {
            dispatch({ type: 'fullscreen-on' });
          },
          () => {
            dispatch({ type: 'fullscreen-refused' });
          },
        );
        return;
      case 'exit-fullscreen':
        if (document.fullscreenElement !== null)
          void document.exitFullscreen().catch(() => undefined);
        return;
      case 'explain-blocked':
        options.say(
          'Choose Restore or Discard for the unsaved changes above before writing in focus.',
          'error',
        );
        return;
    }
  }

  function enter(): void {
    const active = document.activeElement;
    returnTo = active instanceof HTMLElement && active !== document.body ? active : button;
    scroll = { x: window.scrollX, y: window.scrollY };
    options.say('');
    options.write();

    const kept = [titleField, bodyField, bar].filter((element) => element !== null);
    hidden = outsideOf<Element>(document.body, kept, {
      parentOf: (element) => element.parentElement,
      childrenOf: (element) => Array.from(element.children),
    }).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && !element.hidden && !element.inert,
    );
    for (const element of hidden) {
      element.hidden = true;
      element.inert = true;
    }
    styled = [
      style(sheet, LOOK.focusSheet),
      style(column, LOOK.focusColumn),
      ...(title instanceof HTMLInputElement ? [style(title, LOOK.focusTitle)] : []),
    ];

    const line = document.getElementById(AUTOSAVE_STATUS_ID);
    if (line !== null && line.parentNode !== null) {
      status = { element: line, parent: line.parentNode, next: line.nextSibling };
      exit.before(line);
    }
    count.textContent = wordsLabel(wordCount(view.state.doc.toString()));
    bar.hidden = false;
    document.documentElement.classList.add(ON);

    if (!kept.some((element) => element.contains(document.activeElement))) view.focus();
    view.requestMeasure();
  }

  function leave(): void {
    document.documentElement.classList.remove(ON);
    bar.hidden = true;
    if (status !== undefined) {
      status.parent.insertBefore(status.element, status.next);
      status = undefined;
    }
    for (const element of hidden) {
      element.hidden = false;
      element.inert = false;
    }
    hidden = [];
    for (const { element, added } of styled) element.classList.remove(...added);
    styled = [];

    if (view.dom.contains(returnTo)) view.focus();
    else (returnTo.isConnected ? returnTo : button).focus({ preventScroll: true });
    window.scrollTo(scroll.x, scroll.y);
  }

  function style(element: HTMLElement, classes: string): { element: HTMLElement; added: string[] } {
    const added = classes.split(' ').filter((name) => !element.classList.contains(name));
    element.classList.add(...added);
    return { element, added };
  }

  return {
    button,
    changed: (doc) => {
      if (state.on) count.textContent = wordsLabel(wordCount(doc.toString()));
    },
  };
}

function layoutAround(
  surface: HTMLElement,
): { sheet: HTMLElement; column: HTMLElement; bodyField: HTMLElement } | undefined {
  const sheet = surface.closest<HTMLElement>('.card');
  const column = surface.closest<HTMLElement>('.card-body');
  const bodyField = surface.closest<HTMLElement>('.fieldset');
  if (sheet === null || column === null || bodyField === null) return undefined;
  return { sheet, column, bodyField };
}
