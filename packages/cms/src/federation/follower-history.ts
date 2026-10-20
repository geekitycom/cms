/**
 * Every follow and unfollow the site has had, in `data/follower-history.jsonl`
 * (TASK-446). The followers file holds only who follows now, so an unfollow
 * leaves no trace there. Each line is one change with the site's follower
 * count after it, kept as an instant so the dashboard can place it on the
 * site's day in whatever time zone the site has when it is read.
 */
import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import { FOLLOWER_HISTORY, dataPath } from '../files/data-files.ts';
import { calendarDayIn } from '../content/time.ts';
import { isRecord } from '../util/guards.ts';

export interface FollowerChange {
  /** When, as an ISO instant. */
  readonly at: string;
  /** Which user was followed or unfollowed. */
  readonly username: string;
  readonly change: 'follow' | 'unfollow';
  /** How many actors followed the site, counting every user, after the change. */
  readonly count: number;
}

export interface FollowerDay {
  /** `YYYY-MM-DD` in the site's time zone. */
  readonly day: string;
  /** The site's follower count at the end of the day. */
  readonly count: number;
  readonly gained: number;
  readonly lost: number;
}

function historyFile(dataDir: string): string {
  return dataPath(dataDir, FOLLOWER_HISTORY);
}

function changeFrom(line: string): FollowerChange | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const { at, username, change, count } = parsed;
  if (typeof at !== 'string' || typeof username !== 'string' || typeof count !== 'number') {
    return undefined;
  }
  if (change !== 'follow' && change !== 'unfollow') return undefined;
  return { at, username, change, count };
}

export function readFollowerChanges(dataDir: string): FollowerChange[] {
  const source = readFileIfPresentSync(historyFile(dataDir)) ?? '';
  return source
    .split('\n')
    .flatMap((line) => changeFrom(line) ?? [])
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export async function recordFollowerChange(dataDir: string, change: FollowerChange): Promise<void> {
  const line = `${JSON.stringify(change)}\n`;
  await updateFileAtomically(historyFile(dataDir), (current) => `${current ?? ''}${line}`);
}

/**
 * The count, follows and unfollows of each of `days`, which are consecutive
 * and oldest first. A day with no change keeps the count of the day before. A
 * day before the first change has the count that change started from, and
 * with no changes at all every day has `current`, so a site with no history
 * draws a flat line rather than a climb from zero.
 */
export function followerDays(
  changes: readonly FollowerChange[],
  days: readonly string[],
  timezone: string,
  current: number,
): FollowerDay[] {
  const placed = changes.flatMap((change) => {
    const day = calendarDayIn(change.at, timezone);
    return day === undefined ? [] : [{ ...change, day }];
  });
  const first = placed[0];
  let count = first === undefined ? current : first.count + (first.change === 'follow' ? -1 : 1);
  for (const change of placed) {
    if (change.day < (days[0] ?? '')) count = change.count;
  }

  return days.map((day) => {
    const ofDay = placed.filter((change) => change.day === day);
    const last = ofDay.at(-1);
    if (last !== undefined) count = last.count;
    return {
      day,
      count,
      gained: ofDay.filter((change) => change.change === 'follow').length,
      lost: ofDay.filter((change) => change.change === 'unfollow').length,
    };
  });
}
