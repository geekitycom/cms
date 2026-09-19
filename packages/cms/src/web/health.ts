import { opendir } from 'node:fs/promises';

import type { Context, Hono } from 'hono';

import type { GeekityEnv } from '../env.ts';

/** Where the health check answers. */
export const HEALTH_PATH = '/healthz';

/** The outcome of one check. */
export type HealthOutcome = 'ok' | 'fail';

/** The body of a `/healthz` response. */
export interface HealthReport {
  status: HealthOutcome;
  checks: { database: HealthOutcome; content: HealthOutcome };
}

/** Run `check`, reducing whatever it throws to a bare `fail`. */
async function outcome(check: () => unknown): Promise<HealthOutcome> {
  try {
    await check();
    return 'ok';
  } catch {
    return 'fail';
  }
}

/**
 * Whether this site can serve, checked the cheapest way that still proves it:
 * one query against the content index, and opening the content directory for
 * reading. Neither reason for a failure is kept, so the report can be shown to
 * anybody.
 */
export async function healthReport(c: Context<GeekityEnv>): Promise<HealthReport> {
  const database = await outcome(() => c.var.store.counts());
  const content = await outcome(async () => {
    const dir = await opendir(c.var.config.contentDir);
    await dir.close();
  });
  const status = database === 'ok' && content === 'ok' ? 'ok' : 'fail';
  return { status, checks: { database, content } };
}

/**
 * Mount `GET /healthz` on the app.
 *
 * A checker reads only the status code, so a failing check is a 503 rather
 * than a 200 carrying `status: 'fail'`. The answer is never cached, since a
 * cached "ok" would outlive the thing it vouched for, and it touches no
 * session, so probing it every minute creates nothing.
 */
export function mountHealth(app: Hono<GeekityEnv>): void {
  app.get(HEALTH_PATH, async (c) => {
    const report = await healthReport(c);
    c.header('Cache-Control', 'no-store');
    return c.json(report, report.status === 'ok' ? 200 : 503);
  });
}
