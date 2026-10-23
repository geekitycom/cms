import { addedWords } from '../content/words.ts';

/** Words written today as the server last reported them, and the body it had then. */
export interface WordsBaseline {
  readonly body: string;
  readonly today: number;
}

/** "1,240 words", or "1,240 words · 312 today" when there is a figure for today. */
export function wordsLabel(count: number, today?: number): string {
  const words = `${count.toLocaleString('en-US')} ${count === 1 ? 'word' : 'words'}`;
  return today === undefined ? words : `${words} · ${today.toLocaleString('en-US')} today`;
}

/** Today's total with the words added to `body` since the baseline, which the next autosave credits. */
export function wordsTodayAt(baseline: WordsBaseline, body: string): number {
  return baseline.today + addedWords(baseline.body, body);
}
