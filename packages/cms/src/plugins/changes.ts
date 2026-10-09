/**
 * The record of who added, updated and removed which plugin from Admin >
 * Plugins (TASK-306), in `data/plugin-changes.json`. It cannot be rebuilt
 * from anything else, so it is a file (decision-9).
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';

export const PLUGIN_CHANGES_FILE = 'plugin-changes.json';

/** How many changes are kept, newest first. */
const PLUGIN_CHANGES_LIMIT = 200;

export type PluginChange =
  | {
      readonly action: 'add';
      readonly name: string;
      readonly to: string;
      /** The version the folder held before, when it held one. */
      readonly from?: string | undefined;
    }
  | { readonly action: 'update'; readonly name: string; readonly from: string; readonly to: string }
  | { readonly action: 'remove'; readonly name: string; readonly from?: string | undefined };

export type PluginChangeEntry = PluginChange & {
  readonly id: string;
  /** When, as an ISO instant. */
  readonly at: string;
  /** The username of the admin who made it. */
  readonly user: string;
};

function changesFile(dataDir: string): string {
  return path.join(dataDir, PLUGIN_CHANGES_FILE);
}

function parse(text: string | undefined): PluginChangeEntry[] {
  if (text === undefined) return [];
  try {
    const parsed = JSON.parse(text) as { entries?: unknown };
    return Array.isArray(parsed.entries) ? (parsed.entries as PluginChangeEntry[]) : [];
  } catch {
    return [];
  }
}

/** Every recorded change, newest first. */
export function readPluginChanges(dataDir: string): PluginChangeEntry[] {
  return parse(readFileIfPresentSync(changesFile(dataDir)));
}

export async function recordPluginChanges(
  dataDir: string,
  by: { user: string; at: Date },
  changes: readonly PluginChange[],
): Promise<void> {
  if (changes.length === 0) return;
  const at = by.at.toISOString();
  const added = changes.map((change) => ({ ...change, id: randomUUID(), at, user: by.user }));
  await updateFileAtomically(
    changesFile(dataDir),
    (current) => {
      const entries = [...added.reverse(), ...parse(current)].slice(0, PLUGIN_CHANGES_LIMIT);
      return `${JSON.stringify({ entries }, null, 2)}\n`;
    },
    { mode: 0o600 },
  );
}
