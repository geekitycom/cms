/**
 * Who is waiting on a reload. One reload runs at a time, so a
 * reload asked for while one is under way waits for the next: it is taken up
 * when that next reload begins, and answered when that one ends.
 */

import type { ReloadOutcome } from './supervision.ts';

type Answer = (outcome: ReloadOutcome) => void;

export interface ReloadQueue {
  /** Ask for a reload; resolves when the reload that takes it up ends. */
  ask(): Promise<ReloadOutcome>;
  /** Whether a reload was asked for that no reload has taken up yet. */
  hasAsked(): boolean;
  /** A reload begins: it takes up every request made so far. */
  begin(): void;
  /** The reload under way ended: answer every request it took up. */
  answer(outcome: ReloadOutcome): void;
  /** Answer every request, taken up or not. */
  answerAll(outcome: ReloadOutcome): void;
}

export function createReloadQueue(): ReloadQueue {
  let asked: Answer[] = [];
  let underWay: Answer[] = [];

  function begin(): void {
    underWay = [...underWay, ...asked];
    asked = [];
  }

  function answer(outcome: ReloadOutcome): void {
    for (const done of underWay) done(outcome);
    underWay = [];
  }

  return {
    ask() {
      return new Promise<ReloadOutcome>((resolve) => {
        asked.push(resolve);
      });
    },
    hasAsked: () => asked.length > 0,
    begin,
    answer,
    answerAll(outcome) {
      begin();
      answer(outcome);
    },
  };
}
