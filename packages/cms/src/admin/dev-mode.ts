/**
 * Tools > Dev mode (TASK-295, decision-35): what the site held back while it
 * was in dev mode, so a migration can show it would have been silent.
 */

import type { Hono } from 'hono';

import { devModeOn, readDevModeRecord } from '../dev-mode.ts';
import type { DevModeEntry, HeldKind } from '../dev-mode.ts';
import type { GeekityEnv } from '../env.ts';
import type { AdminRender } from './documents.ts';
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

export function mountDevModeScreen(app: Hono<GeekityEnv>, options: { render: AdminRender }): void {
  app.get(DEV_MODE_PATH, (c) => {
    const record = readDevModeRecord(c.var.config.dataDir);
    return options.render(c, ADMIN_TEMPLATES.toolsDevMode, {
      section: TOOLS_SECTION,
      child: DEV_MODE_CHILD,
      heading: 'Dev mode',
      on: devModeOn(c.var.config),
      heldCount: record.filter((entry) => entry.type === 'held').length,
      shown: SHOWN,
      rows: record.slice(-SHOWN).reverse().map(row),
    });
  });
}

function row(entry: DevModeEntry): {
  at: string;
  what: string;
  detail: string;
  to: readonly string[];
} {
  if (entry.type === 'on') {
    return {
      at: entry.at,
      what: 'Dev mode on',
      detail:
        entry.by === 'config' ? 'GEEKITY_DEV_MODE or the devMode setting' : 'geekity dev-mode on',
      to: [],
    };
  }
  if (entry.type === 'off') {
    return { at: entry.at, what: 'Went live', detail: 'geekity dev-mode off', to: [] };
  }
  return { at: entry.at, what: KIND_LABELS[entry.kind], detail: entry.what, to: entry.to };
}
