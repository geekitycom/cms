import { permalinkFile } from './permalink-file.ts';
import type { PermalinkFile } from './permalink-file.ts';

export const KEPT_PROPERTIES_FILE = 'kept-properties.json';

export type KeptProperties = Readonly<Record<string, readonly unknown[]>>;

export function keptProperties(dataDir: string): PermalinkFile<KeptProperties> {
  return permalinkFile(dataDir, KEPT_PROPERTIES_FILE, keptOf);
}

function keptOf(value: unknown): KeptProperties | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const kept = Object.entries(value).filter(
    ([, values]) => Array.isArray(values) && values.length > 0,
  );
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
}
