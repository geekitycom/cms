import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { readFileIfPresentSync, writeFileAtomicallySync } from './files/atomic.ts';

const DEV_MODE_FILE = 'dev-mode.json';
const DEV_MODE_RECORD_FILE = 'dev-mode.jsonl';

export type HeldKind = 'activitypub' | 'webmention' | 'feed-ping' | 'indexnow' | 'mail';

export interface OutboundEffect {
  readonly kind: HeldKind;
  readonly what: string;
  readonly to: readonly string[];
}

export type DevModeSource = 'config' | 'command';

export type DevModeEntry =
  | { readonly type: 'on'; readonly at: string; readonly by: DevModeSource }
  | { readonly type: 'off'; readonly at: string }
  | ({ readonly type: 'held'; readonly at: string } & OutboundEffect);

export interface DevModeConfig {
  readonly dataDir: string;
  readonly devMode: boolean;
}

// Looked for on every call, so `geekity dev-mode off` takes a running site live at once.
export function devModeOn(config: DevModeConfig): boolean {
  return config.devMode || existsSync(stateFile(config.dataDir));
}

export function enterDevMode(dataDir: string, by: DevModeSource, now = new Date()): boolean {
  if (existsSync(stateFile(dataDir))) return false;
  writeFileAtomicallySync(
    stateFile(dataDir),
    `${JSON.stringify({ since: now.toISOString(), by }, null, 2)}\n`,
  );
  append(dataDir, { type: 'on', at: now.toISOString(), by });
  return true;
}

export function leaveDevMode(dataDir: string, now = new Date()): boolean {
  if (!existsSync(stateFile(dataDir))) return false;
  rmSync(stateFile(dataDir), { force: true });
  append(dataDir, { type: 'off', at: now.toISOString() });
  return true;
}

// A held effect is dropped, never queued, so going live replays nothing.
export function holdOutbound(config: DevModeConfig, effect: OutboundEffect): boolean {
  if (!devModeOn(config)) return false;
  append(config.dataDir, {
    type: 'held',
    at: new Date().toISOString(),
    kind: effect.kind,
    what: effect.what,
    to: [...effect.to],
  });
  return true;
}

export function readDevModeRecord(dataDir: string): DevModeEntry[] {
  const text = readFileIfPresentSync(recordFile(dataDir));
  if (text === undefined) return [];
  const entries: DevModeEntry[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      entries.push(JSON.parse(line) as DevModeEntry);
    } catch {
      continue;
    }
  }
  return entries;
}

function append(dataDir: string, entry: DevModeEntry): void {
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(recordFile(dataDir), `${JSON.stringify(entry)}\n`, 'utf8');
}

function stateFile(dataDir: string): string {
  return path.join(dataDir, DEV_MODE_FILE);
}

function recordFile(dataDir: string): string {
  return path.join(dataDir, DEV_MODE_RECORD_FILE);
}
