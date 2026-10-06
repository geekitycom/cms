import path from 'node:path';

import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import { isWebUrl } from './enclosure.ts';

/** One handle as it resolved. */
export interface ResolvedHandle {
  /** The page a reader is sent to: the actor's `url`, else its id. */
  readonly profile: string;
  /** The actor id a `Mention` names and an activity is addressed to. */
  readonly actor: string;
  readonly inbox: string;
  readonly sharedInbox?: string | undefined;
}

/** The resolved account behind a `user@host` in lower case, if any. */
export type HandleDirectory = (handle: string) => ResolvedHandle | undefined;

/**
 * Where the resolved handles are kept, relative to the content directory: one
 * JSON object keyed by `user@host`. It is beside `replyContexts.json` for the
 * same reason (decision-19): what the web said, read when a page is drawn.
 */
export const HANDLES_FILE = '_data/handles.json';

function fileOf(contentDir: string): string {
  return path.join(contentDir, ...HANDLES_FILE.split('/'));
}

/** The directory as the file holds it now, parsed again only when its bytes change. */
export function handleDirectory(contentDir: string): HandleDirectory {
  const file = fileOf(contentDir);
  let cachedText: string | undefined;
  let cached = new Map<string, ResolvedHandle>();

  return (handle) => {
    const text = readFileIfPresentSync(file);
    if (text !== cachedText) {
      cachedText = text;
      cached = text === undefined ? new Map<string, ResolvedHandle>() : parseHandles(text);
    }
    return cached.get(handle);
  };
}

/** Add resolved handles to the file, replacing any entry under the same handle. */
export async function rememberHandles(
  contentDir: string,
  resolved: Readonly<Record<string, ResolvedHandle>>,
): Promise<void> {
  await updateFileAtomically(fileOf(contentDir), (current) => {
    const all = Object.fromEntries(current === undefined ? [] : parseHandles(current));
    return `${JSON.stringify({ ...all, ...resolved }, null, 2)}\n`;
  });
}

function parseHandles(text: string): Map<string, ResolvedHandle> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return new Map();
  }
  if (typeof data !== 'object' || data === null) return new Map();
  const found = new Map<string, ResolvedHandle>();
  for (const [handle, entry] of Object.entries(data)) {
    const parsed = parseEntry(entry);
    if (parsed !== undefined) found.set(handle, parsed);
  }
  return found;
}

function parseEntry(entry: unknown): ResolvedHandle | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const { profile, actor, inbox, sharedInbox } = entry as Record<string, unknown>;
  if (!isWebAddress(profile) || !isWebAddress(actor) || !isWebAddress(inbox)) return undefined;
  return {
    profile,
    actor,
    inbox,
    ...(isWebAddress(sharedInbox) ? { sharedInbox } : {}),
  };
}

function isWebAddress(value: unknown): value is string {
  return typeof value === 'string' && isWebUrl(value);
}
