import type { ReplyReader } from '../store.ts';
import { SERVED_CLAUSE } from './clauses.ts';
import { nowKey, statement } from './database.ts';
import type { IndexDatabase, Row } from './database.ts';
import { hydrateAll, select } from './documents.ts';

const BY_REPLIES_KEY_SQL = `
  SELECT * FROM documents
  WHERE (replies_key = ?1 OR reply_post_key = ?1) AND ${SERVED_CLAUSE}
  ORDER BY replies_key = ?1 DESC, date_sort DESC, path DESC
`;

export function replyReader(index: IndexDatabase): ReplyReader {
  return {
    listRepliesTo(targets) {
      const wanted = [...new Set(targets)];
      if (wanted.length === 0) return [];
      return select(
        index,
        ["type = 'post'", SERVED_CLAUSE, `in_reply_to IN (${wanted.map(() => '?').join(', ')})`],
        [nowKey(index), ...wanted],
        {},
      );
    },

    listReplyPosts: (options = {}) =>
      select(
        index,
        ["type = 'post'", SERVED_CLAUSE, 'in_reply_to IS NOT NULL'],
        [nowKey(index)],
        options,
      ),

    listByRepliesKey: (key) =>
      hydrateAll(index, statement(index, BY_REPLIES_KEY_SQL).all(key, nowKey(index)) as Row[]),
  };
}
