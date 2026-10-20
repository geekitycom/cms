import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { followerDays, readFollowerChanges, recordFollowerChange } from './follower-history.ts';
import type { FollowerChange } from './follower-history.ts';

const temporaryDirs: string[] = [];

after(async () => {
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const DAYS = ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'];

function change(at: string, kind: FollowerChange['change'], count: number): FollowerChange {
  return { at, username: 'blog', change: kind, count };
}

describe('the follower history', () => {
  it('keeps each change in data/follower-history.jsonl, oldest first', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-follower-history-'));
    temporaryDirs.push(dataDir);

    await recordFollowerChange(dataDir, change('2026-10-18T12:00:00.000Z', 'follow', 1));
    await recordFollowerChange(dataDir, change('2026-10-19T12:00:00.000Z', 'unfollow', 0));

    assert.deepEqual(readFollowerChanges(dataDir), [
      change('2026-10-18T12:00:00.000Z', 'follow', 1),
      change('2026-10-19T12:00:00.000Z', 'unfollow', 0),
    ]);
  });

  it('reads no changes from a site that has none', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-follower-history-'));
    temporaryDirs.push(dataDir);

    assert.deepEqual(readFollowerChanges(dataDir), []);
  });

  it('counts the follows and unfollows of a day in the site’s time zone', () => {
    const days = followerDays(
      [
        change('2026-10-18T12:00:00.000Z', 'follow', 5),
        change('2026-10-18T13:00:00.000Z', 'follow', 6),
        // 23:00 on 18 October in Chicago, though 19 October in UTC.
        change('2026-10-19T04:00:00.000Z', 'unfollow', 5),
      ],
      DAYS,
      'America/Chicago',
      5,
    );

    assert.deepEqual(days[1], { day: '2026-10-18', count: 5, gained: 2, lost: 1 });
  });

  it('gives a day with no change the count of the day before', () => {
    const days = followerDays([change('2026-10-18T12:00:00.000Z', 'follow', 5)], DAYS, 'UTC', 5);

    assert.deepEqual(days.slice(2), [
      { day: '2026-10-19', count: 5, gained: 0, lost: 0 },
      { day: '2026-10-20', count: 5, gained: 0, lost: 0 },
    ]);
  });

  it('gives a day before the first change the count that change started from', () => {
    const days = followerDays(
      [
        change('2026-10-19T12:00:00.000Z', 'unfollow', 4),
        change('2026-10-20T12:00:00.000Z', 'follow', 5),
      ],
      DAYS,
      'UTC',
      5,
    );

    assert.deepEqual(
      days.map((day) => day.count),
      [5, 5, 4, 5],
    );
  });

  it('draws every day at the current count when nothing has been recorded yet', () => {
    const days = followerDays([], DAYS, 'UTC', 12);

    assert.deepEqual(
      days.map(({ count, gained, lost }) => [count, gained, lost]),
      [
        [12, 0, 0],
        [12, 0, 0],
        [12, 0, 0],
        [12, 0, 0],
      ],
    );
  });
});
