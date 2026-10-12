import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countByStatus } from './rows.ts';

const STATUSES = ['sent', 'queued', 'failed'] as const;
type Status = (typeof STATUSES)[number];
const statusOf = (value: unknown): Status =>
  STATUSES.includes(value as Status) ? (value as Status) : 'failed';

describe('countByStatus', () => {
  it('names every status, at zero when no row has it', () => {
    assert.deepEqual(countByStatus([], STATUSES, statusOf), { sent: 0, queued: 0, failed: 0 });
    assert.deepEqual(countByStatus([{ status: 'queued', count: 3 }], STATUSES, statusOf), {
      sent: 0,
      queued: 3,
      failed: 0,
    });
  });

  it('adds a status this version does not know to the one it is read as', () => {
    const rows = [
      { status: 'failed', count: 2 },
      { status: 'bounced', count: 5 },
      { status: 'sent', count: 1 },
    ];

    assert.deepEqual(countByStatus(rows, STATUSES, statusOf), { sent: 1, queued: 0, failed: 7 });
  });
});
