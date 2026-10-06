import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { eventOf } from './event.ts';

describe('eventOf', () => {
  it('reads a start, an end and a place, each start and end as a UTC instant', () => {
    assert.deepEqual(
      eventOf({
        start: '2026-10-10T09:00:00-05:00',
        end: new Date('2026-10-10T22:00:00Z'),
        location: '  Chicago Public Library, 400 S State St  ',
      }),
      {
        start: '2026-10-10T14:00:00Z',
        end: '2026-10-10T22:00:00Z',
        location: { kind: 'place', name: 'Chicago Public Library, 400 S State St' },
      },
    );
  });

  it('takes a web address as a location to join online', () => {
    assert.deepEqual(
      eventOf({ start: '2026-10-10T14:00:00Z', location: 'https://meet.example/camp' }),
      {
        start: '2026-10-10T14:00:00Z',
        location: { kind: 'virtual', url: 'https://meet.example/camp' },
      },
    );
  });

  it('is no event without a readable start, and drops an end before the start', () => {
    assert.equal(eventOf({ end: '2026-10-10T14:00:00Z' }), undefined);
    assert.equal(eventOf({ start: 'tomorrow' }), undefined);
    assert.deepEqual(eventOf({ start: '2026-10-10T14:00:00Z', end: '2026-10-09T14:00:00Z' }), {
      start: '2026-10-10T14:00:00Z',
    });
    assert.deepEqual(eventOf({ start: '2026-10-10T14:00:00Z', location: '  ' }), {
      start: '2026-10-10T14:00:00Z',
    });
  });
});
