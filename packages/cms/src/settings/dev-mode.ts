import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { readFileIfPresentSync } from '../files/atomic.ts';
import { declareNamespace } from './declare.ts';
import { boolean } from './kinds.ts';
import { presenceMeansOn } from './presence.ts';
import type { ChangedBy, SettingChange, SettingsRegistry } from './types.ts';

const DEV_MODE_RECORD_FILE = 'dev-mode.jsonl';

export type HeldKind = 'activitypub' | 'webmention' | 'feed-ping' | 'indexnow' | 'mail';

export interface OutboundEffect {
  readonly kind: HeldKind;
  readonly what: string;
  readonly to: readonly string[];
}

export type DevModeRecordSpelling = 'config' | 'command' | 'admin' | 'plugin';

const RECORD_SPELLING: Record<ChangedBy, DevModeRecordSpelling> = {
  boot: 'config',
  cli: 'command',
  admin: 'admin',
  plugin: 'plugin',
};

export type DevModeEntry =
  | { readonly type: 'on'; readonly at: string; readonly by: DevModeRecordSpelling }
  | { readonly type: 'off'; readonly at: string; readonly by: DevModeRecordSpelling }
  | ({ readonly type: 'held'; readonly at: string } & OutboundEffect);

type LegacyOffEntry = { readonly type: 'off'; readonly at: string; readonly by?: undefined };

export const DEV_MODE = declareNamespace({
  namespace: 'dev_mode',
  storage: { kind: 'file', under: 'data', path: 'dev-mode.json', dataClass: { kept: false } },
  envPrefix: 'GEEKITY_DEV_MODE',
  legacy: presenceMeansOn,
  settings: {
    on: {
      type: boolean,
      default: false,
      description: 'Hold every outbound side effect and record it in data/dev-mode.jsonl.',
      env: false,
      onChange: recordGoingOnOrOff,
    },
  },
});

export const DEV_MODE_LATCHED = 'GEEKITY_DEV_MODE or the devMode setting still asks for dev mode.';

export function latchDevModeOn(settings: SettingsRegistry): void {
  settings.set('dev_mode', new Map([['on', true]]), 'boot').catch((error: unknown) => {
    console.error('Dev mode could not be turned on at boot:', error);
  });
}

function recordGoingOnOrOff({ next, at, by, dirs }: SettingChange<boolean>): void {
  appendDevModeEntry(dirs.dataDir, {
    type: next ? 'on' : 'off',
    at: at.toISOString(),
    by: RECORD_SPELLING[by],
  });
}

export function appendDevModeEntry(dataDir: string, entry: DevModeEntry): void {
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(recordFile(dataDir), `${JSON.stringify(entry)}\n`, 'utf8');
}

export function readDevModeRecord(dataDir: string): DevModeEntry[] {
  const text = readFileIfPresentSync(recordFile(dataDir));
  if (text === undefined) return [];
  const entries: DevModeEntry[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      entries.push(fromRecordLine(line));
    } catch {
      continue;
    }
  }
  return entries;
}

function fromRecordLine(line: string): DevModeEntry {
  const entry = JSON.parse(line) as DevModeEntry | LegacyOffEntry;
  if (entry.type === 'off') return { type: 'off', at: entry.at, by: entry.by ?? 'command' };
  return entry;
}

function recordFile(dataDir: string): string {
  return path.join(dataDir, DEV_MODE_RECORD_FILE);
}
