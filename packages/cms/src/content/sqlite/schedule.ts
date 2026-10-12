import type { ScheduleReader } from '../store.ts';
import { NEXT_DUE_SQL } from './clauses.ts';
import { nowKey, statement, stringOrUndefined } from './database.ts';
import type { IndexDatabase, Row } from './database.ts';
import { hydrateAll } from './documents.ts';

const DUE_SINCE_SQL = `
  SELECT * FROM documents
  WHERE draft = 0 AND trashed = 0
    AND date_sort IS NOT NULL AND date_sort > ? AND date_sort <= ?
  ORDER BY date_sort ASC, path ASC
`;

export function scheduleReader(index: IndexDatabase): ScheduleReader {
  return {
    nextDue: () =>
      stringOrUndefined((statement(index, NEXT_DUE_SQL).get(nowKey(index)) as Row)['due']),
    listDueSince: (after) =>
      hydrateAll(index, statement(index, DUE_SINCE_SQL).all(after, nowKey(index)) as Row[]),
  };
}
