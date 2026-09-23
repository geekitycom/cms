import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Document } from '../content/document.ts';
import { replyTarget } from '../content/post-type.ts';
import type { ContentStore } from '../content/store.ts';
import type { DocumentChange } from '../content/sync.ts';
import { updateFileAtomically } from '../files/atomic.ts';
import type { HostLookup } from './public-address.ts';
import { fetchReplyContext } from './reply-context.ts';
import type { ReplyContext } from './reply-context.ts';

/**
 * Where the fetched reply contexts are kept, relative to the content directory:
 * one JSON object keyed by the URL replied to (decision-19). Eleventy reads it
 * as the `replyContexts` global.
 */
export const REPLY_CONTEXTS_FILE = '_data/replyContexts.json';

/** Where the service reports a target it could not read. */
export interface ReplyContextLogger {
  warn(message: string): void;
}

/** What {@link createReplyContextService} needs. */
export interface CreateReplyContextServiceOptions {
  /** The index, asked which targets are still replied to. */
  readonly store: ContentStore;
  /** Where the file lives. */
  readonly contentDir: string;
  /** How host names are resolved before a target is fetched. */
  readonly lookup: HostLookup;
  /** Defaults to `console`. */
  readonly logger?: ReplyContextLogger | undefined;
}

/** Keeps the stored reply contexts in step with the posts that reply. */
export interface ReplyContextService {
  /**
   * Consider one index change. A reply whose target is new, or has nothing
   * stored, has its target fetched; a target no post replies to any more is
   * forgotten. Returns at once: the work is queued, so a save never waits on
   * a stranger's server.
   */
  handle(change: DocumentChange): void;
  /**
   * Fetch every target a live post replies to that the file holds nothing
   * for. Run when the site starts serving, because a scan of an index that is
   * already up to date reports no change: a site upgraded to reply contexts,
   * or one whose file was removed, would otherwise wait for each reply to be
   * edited. Queued like {@link ReplyContextService.handle}.
   */
  catchUp(): void;
  /** The stored context for a target, from the file. Never touches the network. */
  read(target: string): ReplyContext | undefined;
  /** Resolve once everything queued has finished, however it finished. */
  settled(): Promise<void>;
}

/** Build the reply context service for one site. */
export function createReplyContextService(
  options: CreateReplyContextServiceOptions,
): ReplyContextService {
  const { store, lookup } = options;
  const logger = options.logger ?? console;
  const file = path.join(options.contentDir, ...REPLY_CONTEXTS_FILE.split('/'));

  let cachedText: string | undefined;
  let cached: Record<string, ReplyContext> = {};

  /** The whole file, parsed only when its bytes changed since the last read. */
  function readAll(): Record<string, ReplyContext> {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      cachedText = undefined;
      cached = {};
      return cached;
    }
    if (text !== cachedText) {
      cachedText = text;
      cached = parseContexts(text);
    }
    return cached;
  }

  /** Rewrite the file with one target's entry set, or removed when `undefined`. */
  async function write(target: string, context: ReplyContext | undefined): Promise<void> {
    await updateFileAtomically(file, (current) => {
      const all = current === undefined ? {} : parseContexts(current);
      if (context === undefined) delete all[target];
      else all[target] = context;
      return `${JSON.stringify(all, null, 2)}\n`;
    });
  }

  async function refresh(target: string): Promise<void> {
    const fetched = await fetchReplyContext(target, { lookup });
    if (!fetched.ok) {
      logger.warn(`Could not read ${target} for a reply's context: ${fetched.reason}`);
      return;
    }
    await write(target, fetched.context);
  }

  /** Forget a target, unless a post still replies to it. */
  async function forget(target: string): Promise<void> {
    if (!(target in readAll())) return;
    const stillAnswered = store.listAll().some((document) => replyTarget(document) === target);
    if (!stillAnswered) await write(target, undefined);
  }

  let chain: Promise<unknown> = Promise.resolve();
  function enqueue(task: () => Promise<void>): void {
    chain = chain.then(task).catch((thrown: unknown) => {
      logger.warn(
        `A reply context failed: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      );
    });
  }

  return {
    handle(change) {
      const before = targetOf(change.previous);
      const after = targetOf(change.next);

      // A scan rebuilds the index from files the contexts file sits beside, so
      // it only fetches what that file has never held; an edit fetches a
      // target that changed as well.
      if (after !== undefined) {
        const stored = after in readAll();
        const changed = after !== before && change.origin !== 'scan';
        if (!stored || changed) enqueue(() => refresh(after));
      }
      if (before !== undefined && before !== after) enqueue(() => forget(before));
    },

    catchUp() {
      const held = readAll();
      const missing = new Set<string>();
      for (const document of store.listAll()) {
        const target = replyTarget(document);
        if (target !== undefined && !(target in held)) missing.add(target);
      }
      for (const target of missing) enqueue(() => refresh(target));
    },

    read(target) {
      return readAll()[target];
    },

    settled() {
      return chain.then(ignore);
    },
  };
}

function targetOf(document: Document | undefined): string | undefined {
  return document === undefined ? undefined : replyTarget(document);
}

/**
 * The file's entries, each checked, since a person may have edited it by hand.
 * An entry that is not a context is dropped rather than failing a render.
 */
function parseContexts(text: string): Record<string, ReplyContext> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};

  const contexts: Record<string, ReplyContext> = {};
  for (const [target, value] of Object.entries(parsed)) {
    if (!isRecord(value)) continue;
    const author = isRecord(value['author']) ? value['author'] : undefined;
    const authorName = stringOf(author?.['name']);
    const authorUrl = webUrlOf(author?.['url']);
    contexts[target] = {
      url: target,
      ...optional('name', stringOf(value['name'])),
      ...optional('text', stringOf(value['text'])),
      ...(authorName === undefined
        ? {}
        : { author: { name: authorName, ...optional('url', authorUrl) } }),
      ...optional('published', stringOf(value['published'])),
    };
  }
  return contexts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function webUrlOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

function ignore(): void {
  // Deliberately empty: every failure is already logged against its target.
}
