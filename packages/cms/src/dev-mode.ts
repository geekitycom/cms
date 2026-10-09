import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { readFileIfPresentSync, writeFileAtomicallySync } from './files/atomic.ts';

/**
 * Dev mode (TASK-295, decision-35): a site built or migrated with production
 * data sends nothing to the outside world until the operator takes it live.
 *
 * Two files under `data/`, beside `maintenance.json` and for the same reason:
 * it is operational state, not content. `dev-mode.json` being there is the
 * mode being on. `dev-mode.jsonl` is the record, one JSON object per line:
 * when the mode was entered and left, and every side effect held while it was
 * on. A held effect is dropped, never queued, so going live replays nothing.
 */
const DEV_MODE_FILE = 'dev-mode.json';
const DEV_MODE_RECORD_FILE = 'dev-mode.jsonl';

export type HeldKind = 'activitypub' | 'webmention' | 'feed-ping' | 'indexnow' | 'mail';

export interface OutboundEffect {
  readonly kind: HeldKind;
  /** What would have been sent: an activity's type and id, a URL, a subject. */
  readonly what: string;
  /** Who it would have reached: inboxes, endpoints, addresses. */
  readonly to: readonly string[];
}

/** Who turned the mode on: the `devMode` setting or `GEEKITY_DEV_MODE` at boot, or `geekity dev-mode on`. */
export type DevModeSource = 'config' | 'command';

export type DevModeEntry =
  | { readonly type: 'on'; readonly at: string; readonly by: DevModeSource }
  | { readonly type: 'off'; readonly at: string }
  | ({ readonly type: 'held'; readonly at: string } & OutboundEffect);

export interface DevModeConfig {
  readonly dataDir: string;
  /** The `devMode` setting or `GEEKITY_DEV_MODE`, which hold the mode on whatever the file says. */
  readonly devMode: boolean;
}

/**
 * Whether outbound side effects are held right now. The file is looked for on
 * every call, so `geekity dev-mode off` takes a running site live at once.
 * Only a missing file means live: one that cannot be read or parsed is on.
 */
export function devModeOn(config: DevModeConfig): boolean {
  return config.devMode || existsSync(stateFile(config.dataDir));
}

/** Turn the mode on. Answers whether it was off before; already on records nothing. */
export function enterDevMode(dataDir: string, by: DevModeSource, now = new Date()): boolean {
  if (existsSync(stateFile(dataDir))) return false;
  writeFileAtomicallySync(
    stateFile(dataDir),
    `${JSON.stringify({ since: now.toISOString(), by }, null, 2)}\n`,
  );
  append(dataDir, { type: 'on', at: now.toISOString(), by });
  return true;
}

/** Take the site live. Answers whether it was on; already live records nothing. */
export function leaveDevMode(dataDir: string, now = new Date()): boolean {
  if (!existsSync(stateFile(dataDir))) return false;
  rmSync(stateFile(dataDir), { force: true });
  append(dataDir, { type: 'off', at: now.toISOString() });
  return true;
}

/**
 * Every outbound sender asks this before it touches the network. While the
 * mode is on the effect is recorded and `true` comes back, and the caller
 * sends nothing; otherwise `false`, and it sends as it always did.
 */
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
