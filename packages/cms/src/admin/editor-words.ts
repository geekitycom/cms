import { addedWords } from '../content/words.ts';

export interface WordsBaseline {
  readonly body: string;
  readonly today: number;
}

export function wordsLabel(count: number, today?: number): string {
  const words = `${count.toLocaleString('en-US')} ${count === 1 ? 'word' : 'words'}`;
  return today === undefined ? words : `${words} · ${today.toLocaleString('en-US')} today`;
}

export function wordsTodayAt(baseline: WordsBaseline, body: string): number {
  return baseline.today + addedWords(baseline.body, body);
}
