/**
 * The editor's autosave, without the DOM: when to post the form, what to do
 * with the answer, and when to keep a copy in the browser instead
 * (decision-62). `editor/autosave.ts` wires it to the page; everything here
 * runs under `node:test` with fake timers.
 */

import { isRecord } from '../util/guards.ts';

/** How long typing has to pause before the form is posted. */
export const AUTOSAVE_DELAY_MS = 2000;
const RETRY_FIRST_MS = 2000;
const RETRY_LONGEST_MS = 60_000;
const LOCAL_COPY_VERSION = 1;

/** The form's text fields, in order, without the CSRF token. */
export type Snapshot = readonly (readonly [string, string])[];

/** What one autosave post came back with. */
export type SendOutcome =
  | { readonly kind: 'saved'; readonly savedAt: string }
  /** A network failure or a 5xx. */
  | { readonly kind: 'unreachable' }
  /** A 401 or 403, or a redirect to the login form: the session or its token is gone. */
  | { readonly kind: 'signed-out' }
  /** Any other refusal, with the server's reason. */
  | { readonly kind: 'refused'; readonly message: string };

/** Where the writer's latest copy is, which is what the status line says. */
export type AutosaveStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'server'; readonly at: Date }
  | { readonly state: 'browser'; readonly at: Date }
  | { readonly state: 'signed-out'; readonly at: Date }
  | { readonly state: 'refused'; readonly message: string };

/** A copy kept in localStorage while the server would not take it. */
export interface LocalCopy {
  readonly version: typeof LOCAL_COPY_VERSION;
  readonly key: string;
  /** The `hash` field of the form: the file the copy was edited from. */
  readonly hash: string;
  readonly savedAt: string;
  readonly fields: Snapshot;
}

/** The part of `Storage` this uses. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AutosaveOptions {
  /** The form's `autosave` field. */
  readonly key: string;
  /** Where the browser copy goes; see {@link localCopyKey}. */
  readonly storageKey: string;
  /** `undefined` where localStorage is not available. */
  readonly storage: KeyValueStorage | undefined;
  readonly read: () => Snapshot;
  readonly send: (snapshot: Snapshot) => Promise<SendOutcome>;
  /** Queue the snapshot for a page that is going away; false when it could not be queued. */
  readonly beacon: (snapshot: Snapshot) => boolean;
  readonly now: () => Date;
  /** Start held: a copy is being offered back, and nothing may overwrite it until {@link Autosave.release}. */
  readonly held?: boolean;
}

export interface Autosave {
  /** Something in the form changed: post it once typing pauses. */
  changed(): void;
  /** A field lost focus: post now if anything is waiting. */
  flush(): void;
  /** The page is going away: send what is unsaved with a beacon, or keep it in the browser. */
  leave(): void;
  /** The form is being submitted: stop, so nothing races the save. */
  submitting(): void;
  /** The offered copy was restored or discarded: autosave from here on, starting with what changed meanwhile. */
  release(): void;
  /** Whether the form holds changes the server does not have. */
  unsaved(): boolean;
  status(): AutosaveStatus;
  /** Called on every new status; returns the unsubscribe. */
  subscribe(listener: (status: AutosaveStatus) => void): () => void;
}

/** The localStorage key of the copy of one autosave key, for one user of one site. */
export function localCopyKey(site: string, userId: string, key: string): string {
  return `geekity-autosave:${site}:${userId}:${key}`;
}

/** The copy under `storageKey`, or `undefined` when there is none or it does not parse. */
export function readLocalCopy(storage: KeyValueStorage, storageKey: string): LocalCopy | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(storageKey) ?? 'null');
  } catch {
    return undefined;
  }
  return isLocalCopy(parsed) ? parsed : undefined;
}

function isLocalCopy(value: unknown): value is LocalCopy {
  if (!isRecord(value)) return false;
  const { version, key, hash, savedAt, fields } = value;
  return (
    version === LOCAL_COPY_VERSION &&
    typeof key === 'string' &&
    typeof hash === 'string' &&
    typeof savedAt === 'string' &&
    Array.isArray(fields) &&
    fields.every(
      (field: unknown) =>
        Array.isArray(field) &&
        field.length === 2 &&
        typeof field[0] === 'string' &&
        typeof field[1] === 'string',
    )
  );
}

/** Which copy the editor offers back when it opens. */
export type ResumeOffer =
  | { readonly from: 'none' }
  /** The one the server put in the page's banner. */
  | { readonly from: 'server' }
  | { readonly from: 'browser'; readonly copy: LocalCopy; readonly changedSince: boolean };

export interface ResumeInput {
  /** When the server's copy of this key was saved, if it has one. */
  readonly server: string | undefined;
  /** Whether the page offers the server's copy. */
  readonly offered: boolean;
  readonly local: LocalCopy | undefined;
  /** The file's last save through the admin; empty when it has none. */
  readonly fileTime: string;
  /** The form as the page loaded it. */
  readonly current: Snapshot;
}

/**
 * The newer of the server's and the browser's copies. A browser copy is only
 * worth offering when it is later than both the server copy and the file's
 * last save, and holds something the form does not.
 */
export function resumeOffer(input: ResumeInput): ResumeOffer {
  const { local } = input;
  if (
    local !== undefined &&
    later(local.savedAt, input.server) &&
    later(local.savedAt, input.fileTime) &&
    serialize(local.fields) !== serialize(input.current)
  ) {
    return { from: 'browser', copy: local, changedSince: local.hash !== hashOf(input.current) };
  }
  return input.offered ? { from: 'server' } : { from: 'none' };
}

/** Whether `instant` is after `than`; a missing or unreadable `than` counts as earlier. */
export function later(instant: string, than: string | undefined): boolean {
  if (than === undefined || than === '') return true;
  const other = Date.parse(than);
  return Number.isNaN(other) || Date.parse(instant) > other;
}

/** What the status line says, with times printed by `time`. */
export function statusMessage(status: AutosaveStatus, time: (at: Date) => string): string {
  switch (status.state) {
    case 'idle':
      return '';
    case 'server':
      return `Saved a copy at ${time(status.at)}.`;
    case 'browser':
      return `Server unreachable — saved in this browser at ${time(status.at)}.`;
    case 'signed-out':
      return `You are signed out — saved in this browser at ${time(status.at)}. Sign in again in another tab; nothing has been discarded.`;
    case 'refused':
      return status.message;
  }
}

export function autosave(options: AutosaveOptions): Autosave {
  const { now } = options;
  const listeners = new Set<(status: AutosaveStatus) => void>();
  let current: AutosaveStatus = { state: 'idle' };
  /** The form as the server last had it: as served, then as last autosaved. */
  let onServer = serialize(options.read());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let again = false;
  let failures = 0;
  let stopped = false;
  let held = options.held === true;
  /** Only a copy this page wrote is removed; one found on load is the resume banner's. */
  let wroteLocal = false;

  function announce(status: AutosaveStatus): void {
    current = status;
    for (const listener of listeners) listener(status);
  }

  function cancel(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule(delay: number): void {
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      void attempt();
    }, delay);
  }

  function keepLocally(snapshot: Snapshot, at: Date): void {
    if (options.storage === undefined) return;
    const copy: LocalCopy = {
      version: LOCAL_COPY_VERSION,
      key: options.key,
      hash: hashOf(snapshot),
      savedAt: at.toISOString(),
      fields: snapshot,
    };
    try {
      options.storage.setItem(options.storageKey, JSON.stringify(copy));
      wroteLocal = true;
    } catch {
      // Storage full or refused: the status line still says the server lacks it.
    }
  }

  function dropLocal(): void {
    if (!wroteLocal || options.storage === undefined) return;
    options.storage.removeItem(options.storageKey);
    wroteLocal = false;
  }

  async function attempt(): Promise<void> {
    if (stopped || held) return;
    if (inFlight) {
      again = true;
      return;
    }
    const snapshot = options.read();
    const serialized = serialize(snapshot);
    if (serialized === onServer) {
      dropLocal();
      return;
    }

    inFlight = true;
    const outcome = await options.send(snapshot);
    inFlight = false;
    if (stopped) return;

    const at = now();
    switch (outcome.kind) {
      case 'saved':
        onServer = serialized;
        failures = 0;
        dropLocal();
        announce({ state: 'server', at: savedTime(outcome.savedAt, at) });
        break;
      case 'unreachable':
        keepLocally(snapshot, at);
        announce({ state: 'browser', at });
        again = false;
        schedule(Math.min(RETRY_FIRST_MS * 2 ** failures, RETRY_LONGEST_MS));
        failures += 1;
        return;
      case 'signed-out':
        keepLocally(snapshot, at);
        announce({ state: 'signed-out', at });
        break;
      case 'refused':
        keepLocally(snapshot, at);
        announce({ state: 'refused', message: outcome.message });
        break;
    }

    if (again) {
      again = false;
      schedule(AUTOSAVE_DELAY_MS);
    }
  }

  return {
    changed() {
      if (stopped) return;
      schedule(AUTOSAVE_DELAY_MS);
    },
    flush() {
      if (stopped) return;
      cancel();
      void attempt();
    },
    leave() {
      if (stopped || held) return;
      cancel();
      const snapshot = options.read();
      if (serialize(snapshot) === onServer) return;
      if (!options.beacon(snapshot)) keepLocally(snapshot, now());
    },
    submitting() {
      stopped = true;
      cancel();
    },
    release() {
      if (!held) return;
      held = false;
      if (!stopped && serialize(options.read()) !== onServer) schedule(AUTOSAVE_DELAY_MS);
    },
    unsaved() {
      return !stopped && serialize(options.read()) !== onServer;
    },
    status() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The form's `hash` field: the file it was filled in from. */
function hashOf(snapshot: Snapshot): string {
  return snapshot.find(([name]) => name === 'hash')?.[1] ?? '';
}

function serialize(snapshot: Snapshot): string {
  return JSON.stringify(snapshot);
}

/** The server's own time for the copy, or ours when it sent something odd. */
function savedTime(savedAt: string, fallback: Date): Date {
  const parsed = Date.parse(savedAt);
  return Number.isNaN(parsed) ? fallback : new Date(parsed);
}
