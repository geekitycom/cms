import { isRecord } from '../util/guards.ts';

export const AUTOSAVE_DELAY_MS = 2000;
const RETRY_FIRST_MS = 2000;
const RETRY_LONGEST_MS = 60_000;
const LOCAL_COPY_VERSION = 1;

export type Snapshot = readonly (readonly [string, string])[];

export type SendOutcome =
  | { readonly kind: 'saved'; readonly savedAt: string }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'refused'; readonly message: string };

export type AutosaveStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'server'; readonly at: Date }
  | { readonly state: 'browser'; readonly at: Date }
  | { readonly state: 'signed-out'; readonly at: Date }
  | { readonly state: 'refused'; readonly message: string };

export interface LocalCopy {
  readonly version: typeof LOCAL_COPY_VERSION;
  readonly key: string;
  readonly hash: string;
  readonly savedAt: string;
  readonly fields: Snapshot;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AutosaveOptions {
  readonly key: string;
  readonly storageKey: string;
  readonly storage: KeyValueStorage | undefined;
  readonly read: () => Snapshot;
  readonly send: (snapshot: Snapshot) => Promise<SendOutcome>;
  readonly beacon: (snapshot: Snapshot) => boolean;
  readonly now: () => Date;
  readonly held?: boolean;
}

export interface Autosave {
  changed(): void;
  flush(): void;
  leave(): void;
  submitting(): void;
  release(): void;
  unsaved(): boolean;
  status(): AutosaveStatus;
  subscribe(listener: (status: AutosaveStatus) => void): () => void;
}

export function localCopyKey(site: string, userId: string, key: string): string {
  return `geekity-autosave:${site}:${userId}:${key}`;
}

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

export type ResumeOffer =
  | { readonly from: 'none' }
  | { readonly from: 'server' }
  | { readonly from: 'browser'; readonly copy: LocalCopy; readonly changedSince: boolean };

export interface ResumeInput {
  readonly server: string | undefined;
  readonly offered: boolean;
  readonly local: LocalCopy | undefined;
  readonly fileTime: string;
  readonly current: Snapshot;
}

export function resumeOffer(input: ResumeInput): ResumeOffer {
  const { local } = input;
  if (
    local !== undefined &&
    laterOrOnlyKnown(local.savedAt, input.server) &&
    laterOrOnlyKnown(local.savedAt, input.fileTime) &&
    serialize(local.fields) !== serialize(input.current)
  ) {
    return { from: 'browser', copy: local, changedSince: local.hash !== hashOf(input.current) };
  }
  return input.offered ? { from: 'server' } : { from: 'none' };
}

export function laterOrOnlyKnown(instant: string, than: string | undefined): boolean {
  if (than === undefined || than === '') return true;
  const other = Date.parse(than);
  return Number.isNaN(other) || Date.parse(instant) > other;
}

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
  let onServer = serialize(options.read());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let again = false;
  let failures = 0;
  let stopped = false;
  let held = options.held === true;
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

function hashOf(snapshot: Snapshot): string {
  return snapshot.find(([name]) => name === 'hash')?.[1] ?? '';
}

function serialize(snapshot: Snapshot): string {
  return JSON.stringify(snapshot);
}

function savedTime(savedAt: string, fallback: Date): Date {
  const parsed = Date.parse(savedAt);
  return Number.isNaN(parsed) ? fallback : new Date(parsed);
}
