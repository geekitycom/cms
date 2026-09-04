import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calendarDayIn, toUtcInstant, wallClockIn, zoneLabel } from './time.ts';

describe('toUtcInstant', () => {
  it('reads an offset-less wall clock in the given zone', () => {
    assert.equal(toUtcInstant('2026-09-04 09:00', 'America/Chicago'), '2026-09-04T14:00:00Z');
  });

  it('keeps the instant a written offset already fixes, whatever the zone', () => {
    assert.equal(
      toUtcInstant('2026-06-02T07:30:00-05:00', 'Europe/London'),
      '2026-06-02T12:30:00Z',
    );
    assert.equal(toUtcInstant('2026-06-02T07:30:00-05:00', 'UTC'), '2026-06-02T12:30:00Z');
  });

  it('leaves an instant that is already UTC alone', () => {
    assert.equal(toUtcInstant('2026-06-02T12:30:00Z', 'America/Chicago'), '2026-06-02T12:30:00Z');
  });

  it('takes a bare day as midnight in the zone', () => {
    assert.equal(toUtcInstant('2026-09-04', 'America/Chicago'), '2026-09-04T05:00:00Z');
  });

  it('pushes a wall clock a clock change skipped past the gap', () => {
    // 02:30 does not happen in Chicago on 8 March 2026; the hour after the
    // gap is what the author meant by "half past two".
    assert.equal(toUtcInstant('2026-03-08 02:30:00', 'America/Chicago'), '2026-03-08T08:30:00Z');
  });

  it('falls back to UTC for a zone the runtime does not know', () => {
    assert.equal(toUtcInstant('2026-09-04 09:00', 'Mars/Olympus'), '2026-09-04T09:00:00Z');
  });

  it('is undefined for a date nobody can read', () => {
    assert.equal(toUtcInstant('one fine morning', 'UTC'), undefined);
  });
});

describe('wallClockIn', () => {
  it('shows an instant as the clock reads in the zone', () => {
    assert.equal(wallClockIn('2026-09-04T14:00:00Z', 'America/Chicago'), '2026-09-04 09:00:00');
  });

  it('round-trips an instant through toUtcInstant', () => {
    const instant = '2026-01-01T04:59:59Z';
    assert.equal(toUtcInstant(wallClockIn(instant, 'America/Chicago'), 'America/Chicago'), instant);
  });

  it('keeps sub-second digits so an instant that has them round-trips too', () => {
    const instant = '2026-09-04T05:02:34.785Z';
    assert.equal(wallClockIn(instant, 'America/Chicago'), '2026-09-04 00:02:34.785');
    assert.equal(toUtcInstant(wallClockIn(instant, 'America/Chicago'), 'America/Chicago'), instant);
  });

  it('is empty for a date nobody can read', () => {
    assert.equal(wallClockIn('not a date', 'America/Chicago'), '');
  });
});

describe('calendarDayIn', () => {
  it('takes the day the zone was on, not the day UTC was on', () => {
    // Half past midnight in Berlin on 1 October is half past ten at night on
    // 30 September in UTC: the post belongs to October.
    assert.equal(calendarDayIn('2026-09-30T22:30:00Z', 'Europe/Berlin'), '2026-10-01');
    assert.equal(calendarDayIn('2026-09-30T22:30:00Z', 'UTC'), '2026-09-30');
  });

  it('falls back to UTC for a zone the runtime does not know', () => {
    assert.equal(calendarDayIn('2026-09-30T22:30:00Z', 'Mars/Olympus'), '2026-09-30');
  });
});

describe('zoneLabel', () => {
  it('names the zone and the abbreviation in force at that instant', () => {
    assert.equal(zoneLabel('2026-09-04T14:00:00Z', 'America/Chicago'), 'America/Chicago (CDT)');
    assert.equal(zoneLabel('2026-01-04T14:00:00Z', 'America/Chicago'), 'America/Chicago (CST)');
  });

  it('is the zone alone when it has no abbreviation to add', () => {
    assert.equal(zoneLabel('2026-09-04T14:00:00Z', 'UTC'), 'UTC');
  });
});
