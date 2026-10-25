import type { Page } from '../../store/rows.ts';
import { nullable } from '../../util/json-schema.ts';

export const DEFAULT_LIMIT = 20;

export const PAGE_INPUT = {
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: 100,
    description: `How many to return. ${String(DEFAULT_LIMIT)} unless given.`,
  },
  offset: {
    type: 'integer',
    minimum: 0,
    description: 'How many matches to skip: the nextOffset of the page before.',
  },
} as const;

export const TIME_INPUT = {
  since: { type: 'string', description: 'Only records at or after this ISO 8601 instant.' },
  until: { type: 'string', description: 'Only records before this ISO 8601 instant.' },
} as const;

export const PAGE_OUTPUT = {
  total: { type: 'integer', description: 'How many records match, across every page.' },
  nextOffset: nullable({
    type: 'integer',
    description: 'The offset that asks for the next page, or null on the last one.',
  }),
} as const;

export const PAGE_REQUIRED = ['total', 'nextOffset'] as const;

export interface PageAt {
  readonly limit: number;
  readonly offset: number;
}

export function pageAt(args: { readonly limit?: number; readonly offset?: number }): PageAt {
  return { limit: args.limit ?? DEFAULT_LIMIT, offset: args.offset ?? 0 };
}

export function pageFields<T>(
  page: Page<T>,
  at: PageAt,
): { total: number; nextOffset: number | null } {
  const next = at.offset + page.items.length;
  return { total: page.total, nextOffset: next < page.total ? next : null };
}

export function counted(
  total: number,
  noun: string,
  plural: string,
  shown: number,
  offset: number,
): string {
  return `${String(total)} ${total === 1 ? noun : plural}; showing ${String(shown)} from ${String(offset)}.`;
}

export function pageOfList<T>(items: readonly T[], at: PageAt): Page<T> {
  return { total: items.length, items: items.slice(at.offset, at.offset + at.limit) };
}

export type Instants =
  | { readonly ok: true; readonly since?: string; readonly until?: string }
  | { readonly ok: false; readonly message: string };

export function instants(args: { readonly since?: string; readonly until?: string }): Instants {
  const parsed: { since?: string; until?: string } = {};
  for (const key of ['since', 'until'] as const) {
    const value = args[key];
    if (value === undefined) continue;
    const time = Date.parse(value);
    if (Number.isNaN(time)) {
      return { ok: false, message: `${key} must be an ISO 8601 date or instant.` };
    }
    parsed[key] = new Date(time).toISOString();
  }
  return { ok: true, ...parsed };
}

export function within(at: string, range: { readonly since?: string; readonly until?: string }) {
  return (
    (range.since === undefined || at >= range.since) &&
    (range.until === undefined || at < range.until)
  );
}
