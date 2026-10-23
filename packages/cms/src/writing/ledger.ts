import { rmSync } from 'node:fs';

import { calendarDayIn } from '../content/time.ts';
import { addedWords } from '../content/words.ts';
import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import { dataPath, WRITING_LEDGERS } from '../files/data-files.ts';
import { messageOf } from '../util/errors.ts';
import { isRecord } from '../util/guards.ts';

const LEDGER_MODE = 0o600;

export interface WritingLedger {
  readonly days: Readonly<Record<string, number>>;
}

export interface WritingCredit {
  readonly userId: number;
  readonly before: string;
  readonly after: string;
  readonly at: Date;
  readonly timezone: string;
}

export function readWritingLedger(dataDir: string, userId: number): WritingLedger {
  const file = ledgerFile(dataDir, userId);
  return parseLedger(file, readFileIfPresentSync(file));
}

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

export function writingDay(at: Date, timezone: string): string {
  const day = calendarDayIn(at, timezone);
  if (day === undefined) throw new Error(`${at.toISOString()} has no calendar day.`);
  return day;
}

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
