import { wordsLabel, wordsTodayAt } from '../src/admin/editor-words.ts';
import type { WordsBaseline } from '../src/admin/editor-words.ts';
import { wordCount } from '../src/content/words.ts';
import { LOOK } from './look.ts';

const WORDS_ID = 'editor-words';
const ANNOUNCE_AFTER_MS = 1500;

export interface WordCounter {
  readonly element: HTMLElement;
  readonly changed: (body: string) => void;
  /** An autosave of `body` answered that the user has written `today` words today. */
  readonly credited: (body: string, today: number) => void;
}

export function wordCounter(body: string): WordCounter | undefined {
  const element = document.getElementById(WORDS_ID);
  if (element === null) return undefined;
  const today = element.dataset['wordsToday'];
  let baseline: WordsBaseline | undefined =
    today === undefined ? undefined : { body, today: Number(today) };
  let current = body;
  let pause: ReturnType<typeof setTimeout> | undefined;

  // Seen and changed on every keystroke, so kept from screen readers, which
  // hear the label only once typing pauses.
  const shown = document.createElement('span');
  shown.setAttribute('aria-hidden', 'true');
  const heard = document.createElement('span');
  heard.className = LOOK.wordsAnnounced;
  heard.setAttribute('role', 'status');
  element.replaceChildren(shown, heard);
  render();

  function label(): string {
    return wordsLabel(
      wordCount(current),
      baseline === undefined ? undefined : wordsTodayAt(baseline, current),
    );
  }

  function render(): void {
    shown.textContent = label();
  }

  return {
    element,
    changed: (next) => {
      current = next;
      render();
      clearTimeout(pause);
      pause = setTimeout(() => {
        heard.textContent = label();
      }, ANNOUNCE_AFTER_MS);
    },
    credited: (saved, total) => {
      if (baseline === undefined) return;
      baseline = { body: saved, today: total };
      render();
    },
  };
}
