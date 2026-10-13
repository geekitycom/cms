import type { Context, Hono } from 'hono';

import { DEV_MODE, DEV_MODE_LATCHED, readDevModeRecord } from '../settings/dev-mode.ts';
import type { DevModeEntry, DevModeRecordSpelling, HeldKind } from '../settings/dev-mode.ts';
import type { GeekityEnv } from '../web/env.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { TOOLS_PATH, TOOLS_SECTION } from './tools.ts';

export const DEV_MODE_PATH = `${TOOLS_PATH}/dev-mode`;

export const DEV_MODE_CHILD = 'dev-mode';

const SHOWN = 500;

const KIND_LABELS: Record<HeldKind, string> = {
  activitypub: 'ActivityPub',
  webmention: 'Webmention',
  'feed-ping': 'rssCloud and WebSub ping',
  indexnow: 'IndexNow',
  mail: 'Email',
};

const ON_BY: Record<DevModeRecordSpelling, string> = {
  config: 'GEEKITY_DEV_MODE or the devMode setting',
  command: 'geekity dev-mode on',
  admin: 'the admin switch',
  plugin: 'a plugin',
};

const OFF_BY: Record<DevModeRecordSpelling, string> = {
  ...ON_BY,
  command: 'geekity dev-mode off',
};

const LATCHED = `${DEV_MODE_LATCHED} Remove it and restart the site, then take it live here.`;

export function mountDevModeScreen(app: Hono<GeekityEnv>, options: { render: AdminRender }): void {
  async function show(c: Context<GeekityEnv>, problem?: string): Promise<Response> {
    const record = readDevModeRecord(c.var.config.dataDir);
    return options.render(c, ADMIN_TEMPLATES.toolsDevMode, {
      section: TOOLS_SECTION,
      child: DEV_MODE_CHILD,
      heading: 'Dev mode',
      saveUrl: DEV_MODE_PATH,
      on: await c.var.settings.get(DEV_MODE.on),
      latched: c.var.config.devMode ? LATCHED : undefined,
      problem,
      heldCount: record.filter((entry) => entry.type === 'held').length,
      shown: SHOWN,
      rows: record.slice(-SHOWN).reverse().map(row),
    });
  }

  app.get(DEV_MODE_PATH, (c) => show(c));

  app.post(DEV_MODE_PATH, async (c) => {
    const on = (await c.req.parseBody())['on'] !== undefined;
    if (!on && c.var.config.devMode) {
      c.status(400);
      return await show(c, LATCHED);
    }
    const result = await c.var.settings.set('dev_mode', new Map([['on', on]]), 'admin');
    if (!result.ok) {
      c.status(400);
      return await show(c, Object.values(result.problems).join(' '));
    }
    flash(c, 'notice', on ? 'Dev mode is on.' : 'Dev mode is off: the site is live.');
    return c.redirect(DEV_MODE_PATH, 303);
  });
}

function row(entry: DevModeEntry): {
  at: string;
  what: string;
  detail: string;
  to: readonly string[];
} {
  if (entry.type === 'on') {
    return { at: entry.at, what: 'Dev mode on', detail: ON_BY[entry.by], to: [] };
  }
  if (entry.type === 'off') {
    return { at: entry.at, what: 'Went live', detail: OFF_BY[entry.by], to: [] };
  }
  return { at: entry.at, what: KIND_LABELS[entry.kind], detail: entry.what, to: entry.to };
}
