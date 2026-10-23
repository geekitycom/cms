import type { Context } from 'hono';

import { wordCount } from '../content/words.ts';
import { findUserById } from '../site/users.ts';
import { trackedWritingGoals } from '../site/writing-goals.ts';
import { messageOf } from '../util/errors.ts';
import type { GeekityEnv } from '../web/env.ts';
import { readWritingLedger, writingDay } from '../writing/ledger.ts';
import { wordsLabel } from './editor-words.ts';

export interface EditorWordCounter {
  readonly label: string;
  /** The signed-in user's words written today, for a user who tracks writing goals only. */
  readonly today: number | undefined;
}

/** The editor's counter as of page load, which the editor bundle keeps up to date (decision-63). */
export function editorWordCounter(c: Context<GeekityEnv>, body: string): EditorWordCounter {
  const today = wordsToday(c);
  return { label: wordsLabel(wordCount(body), today), today };
}

function wordsToday(c: Context<GeekityEnv>): number | undefined {
  const userId = c.var.session?.userId;
  if (userId == null) return undefined;
  const { dataDir, now } = c.var.config;
  const user = findUserById(dataDir, userId);
  if (user === undefined || trackedWritingGoals(user) === undefined) return undefined;
  try {
    return (
      readWritingLedger(dataDir, userId).days[
        writingDay(now(), c.var.siteAtRequestStart.timezone)
      ] ?? 0
    );
  } catch (error) {
    console.warn(`The record of words written for user ${String(userId)}: ${messageOf(error)}`);
    return 0;
  }
}
