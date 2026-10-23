import { rmSync } from 'node:fs';

import { calendarDayIn, DEFAULT_TIMEZONE } from '../content/time.ts';
import { addedWords } from '../content/words.ts';
import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import { dataPath, WRITING_LEDGERS } from '../files/data-files.ts';
import { messageOf } from '../util/errors.ts';
import { isRecord } from '../util/guards.ts';

const LEDGER_MODE = 0o600;

/** A user's words written per day, keyed by `YYYY-MM-DD` in the site timezone. Days with none are absent. */
export interface WritingLedger {
  readonly days: Readonly<Record<string, number>>;
}

export interface WritingCredit {
  readonly userId: number;
  /** The Markdown body the server last saw from this user, or `''` for a new document. */
  readonly before: string;
  /** The Markdown body the user sent now. */
  readonly after: string;
  readonly at: Date;
  readonly timezone: string;
}

export function readWritingLedger(dataDir: string, userId: number): WritingLedger {
  const file = ledgerFile(dataDir, userId);
  return parseLedger(file, readFileIfPresentSync(file));
}

/**
 * Credit the words `after` adds to `before` to the user's day, and answer the
 * user's total for that day. A credit of nothing writes nothing. Callers have
 * already saved the user's text, so a ledger that cannot be read is warned
 * about and answers 0 rather than failing that save.
 */
export async function creditWriting(dataDir: string, credit: WritingCredit): Promise<number> {
  try {
    return await creditDay(dataDir, credit);
  } catch (error) {
    console.warn(`Words written were not credited: ${messageOf(error)}`);
    return 0;
  }
}

async function creditDay(dataDir: string, credit: WritingCredit): Promise<number> {
  const added = addedWords(credit.before, credit.after);
  const day = writingDay(credit.at, credit.timezone);
  const file = ledgerFile(dataDir, credit.userId);
  if (added === 0) return parseLedger(file, readFileIfPresentSync(file)).days[day] ?? 0;

  let total = 0;
  await updateFileAtomically(
    file,
    (current) => {
      const { days } = parseLedger(file, current);
      total = (days[day] ?? 0) + added;
      return `${JSON.stringify({ days: { ...days, [day]: total } }, null, 2)}\n`;
    },
    { mode: LEDGER_MODE },
  );
  return total;
}

export function discardWritingLedger(dataDir: string, userId: number): void {
  rmSync(ledgerFile(dataDir, userId), { force: true });
}

function ledgerFile(dataDir: string, userId: number): string {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new Error(`${String(userId)} is not a user id.`);
  }
  return dataPath(dataDir, WRITING_LEDGERS, `${String(userId)}.json`);
}

/** The ledger day `at` falls on in the site timezone, as `YYYY-MM-DD`. */
export function writingDay(at: Date, timezone: string): string {
  const day = calendarDayIn(at, timezone) ?? calendarDayIn(at, DEFAULT_TIMEZONE);
  if (day === undefined) throw new Error(`${at.toISOString()} has no calendar day.`);
  return day;
}

// The ledger cannot be rebuilt, so a file that does not parse is refused
// rather than overwritten with a fresh one.
function parseLedger(file: string, text: string | undefined): WritingLedger {
  if (text === undefined) return { days: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const days = isRecord(parsed) ? parsed['days'] : undefined;
  if (!isRecord(days) || !Object.values(days).every(isWordTotal)) {
    throw new Error(`${file} is not a writing ledger. Fix or remove it by hand.`);
  }
  return { days: days as Record<string, number> };
}

function isWordTotal(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
