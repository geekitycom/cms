import type { ReloadOutcome } from './supervision.ts';

type Answer = (outcome: ReloadOutcome) => void;

export interface ReloadQueue {
  ask(): Promise<ReloadOutcome>;
  hasAsked(): boolean;
  begin(): void;
  answer(outcome: ReloadOutcome): void;
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
