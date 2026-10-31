import { readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { writeFileAtomically } from '../files/atomic.ts';
import { IMAGES, dataFolder } from '../files/data-files.ts';
import { findAsset } from '../files/static-files.ts';
import type { StaticAsset } from '../files/static-files.ts';
import { isRecord } from '../util/guards.ts';
import type { Upload } from './paths.ts';

/**
 * Sets of files derived from one version of one upload: the responsive widths
 * in `variants.ts` and the site's icons in `icons.ts`.
 *
 * A set is derived whole, from the bytes a version names, and settled: its
 * sidecar beside the files records that version and what came of it, which
 * is either the set or nothing at all. Nothing is remembered as firmly as a
 * set, because a source that could not be decoded costs a full attempt every
 * time it is asked about, until its bytes change and its version with them.
 */

/** One kind of derived set. */
export interface DerivedKind<T> {
  /** The sidecar's filename in the upload's derived directory. */
  readonly sidecar: string;
  /** A set read back out of its sidecar, or `undefined` when it is not that shape. */
  parse(value: unknown, upload: Upload): T | undefined;
  /**
   * Write the set's files and answer the set, or `undefined` when nothing
   * can be derived from these bytes. A failure to write is thrown: that is
   * the server failing, not the upload, and is not remembered.
   */
  derive(upload: Upload): Promise<T | undefined>;
  /** Whether a set derived from this upload would hold a file of this name, read off as little as possible. */
  offers(upload: Upload, name: string): Promise<boolean>;
  /** Whether a set holds a file of this name. */
  holds(set: T, name: string): boolean;
}

/** What one version of an upload came to: `set` is `undefined` when nothing could be derived. */
export interface Settled<T> {
  readonly version: string;
  readonly set: T | undefined;
}

/** Sets already settled, by sidecar path. An entry outlives its sidecar, which may be swept away. */
const settled = new Map<string, Settled<unknown>>();

/**
 * Derivations running, by sidecar path, so concurrent callers share one, and
 * lookups that may yet start one, so settling and removal wait for them too.
 */
const running = new Map<string, Promise<unknown>>();

let lookups = 0;

/** The set one version of an upload settled as, or `undefined` when that version has not been derived. */
export function settledSet<T>(
  kind: DerivedKind<T>,
  upload: Upload,
  version: string,
): Settled<T> | undefined {
  const sidecar = path.join(upload.directory, kind.sidecar);
  let entry = settled.get(sidecar) as Settled<T> | undefined;
  if (entry === undefined) {
    entry = readSidecar(kind, upload, sidecar);
    if (entry !== undefined) settled.set(sidecar, entry);
  }
  return entry?.version === version ? entry : undefined;
}

/** Derive a set from the version of the upload given; two callers at once share one derivation. */
export function deriveSet<T>(
  kind: DerivedKind<T>,
  upload: Upload,
  version: string,
): Promise<T | undefined> {
  const sidecar = path.join(upload.directory, kind.sidecar);
  const inFlight = running.get(sidecar) as Promise<T | undefined> | undefined;
  if (inFlight !== undefined) return inFlight;

  const started = (async () => {
    const set = await kind.derive(upload);
    await mkdir(upload.directory, { recursive: true });
    await writeFileAtomically(sidecar, `${JSON.stringify({ version, set: set ?? null })}\n`);
    settled.set(sidecar, { version, set });
    return set;
  })().finally(() => running.delete(sidecar));
  running.set(sidecar, started);
  return started;
}

/**
 * One file of a set, by name, deriving the set when the file is one it holds
 * or would hold and is not there. Only a name the set lists is ever served,
 * so a sidecar or a write in flight beside the files never is.
 */
export function findDerivedFile<T>(
  kind: DerivedKind<T>,
  upload: Upload,
  version: string,
  name: string,
): Promise<StaticAsset | undefined> {
  const key = path.join(upload.directory, `lookup-${String(++lookups)}`);
  const lookup = lookUp(kind, upload, version, name).finally(() => running.delete(key));
  running.set(key, lookup);
  return lookup;
}

async function lookUp<T>(
  kind: DerivedKind<T>,
  upload: Upload,
  version: string,
  name: string,
): Promise<StaticAsset | undefined> {
  const known = settledSet(kind, upload, version);
  const offered =
    known === undefined ? await kind.offers(upload, name) : holds(kind, known.set, name);
  if (!offered) return undefined;

  const directory = [upload.directory];
  const found = known === undefined ? undefined : findAsset(name, directory);
  if (found !== undefined) return found;
  const set = await deriveSet(kind, upload, version);
  return holds(kind, set, name) ? findAsset(name, directory) : undefined;
}

function holds<T>(kind: DerivedKind<T>, set: T | undefined, name: string): boolean {
  return set !== undefined && kind.holds(set, name);
}

/**
 * Wait for every derivation and lookup running under one site's data
 * directory, and for any that starts while those finish. A failure is not this caller's to
 * report: whoever started the derivation was handed it.
 */
export async function settleDerivedSets(dataDir: string): Promise<void> {
  await waitUnder(dataFolder(dataDir, IMAGES));
}

/**
 * Take every set derived from one upload away: wait for the derivations
 * writing into its directory, forget what they settled, then remove it.
 */
export async function forgetDerivedSets(upload: Upload): Promise<void> {
  await waitUnder(upload.directory);
  const inside = upload.directory + path.sep;
  for (const sidecar of settled.keys()) {
    if (sidecar.startsWith(inside)) settled.delete(sidecar);
  }
  await rm(upload.directory, { recursive: true, force: true });
}

async function waitUnder(directory: string): Promise<void> {
  const inside = directory + path.sep;
  for (;;) {
    const waiting = [...running]
      .filter(([sidecar]) => sidecar.startsWith(inside))
      .map(([, derivation]) => derivation);
    if (waiting.length === 0) return;
    await Promise.allSettled(waiting);
  }
}

function readSidecar<T>(
  kind: DerivedKind<T>,
  upload: Upload,
  sidecar: string,
): Settled<T> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(sidecar, 'utf8'));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.version !== 'string') return undefined;
  if (parsed.set === null) return { version: parsed.version, set: undefined };
  const set = kind.parse(parsed.set, upload);
  return set === undefined ? undefined : { version: parsed.version, set };
}
