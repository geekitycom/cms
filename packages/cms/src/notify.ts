import { readSiteSettings, taxonomyBasesFromSettings } from './admin/settings.ts';
import type { ResolvedConfig } from './config.ts';
import type { Document } from './content/document.ts';
import type { DocumentChange } from './content/sync.ts';
import { isFederatedDocument } from './federation/article.ts';
import { FEED_FORMATS, notifyEndpoints } from './web/feeds.ts';
import type { NotifyServer } from './web/feeds.ts';
import { absoluteUrl } from './web/negotiate.ts';
import { feedHref } from './web/routes.ts';
import { TAXONOMIES } from './web/taxonomy.ts';
import type { TaxonomyTerm } from './web/taxonomy.ts';

/**
 * How long one ping is given before it is abandoned.
 *
 * A notify server refetches the feed before it fans anything out, so a slow
 * answer is normal and a hung one must not hold the queue behind it.
 */
export const NOTIFY_TIMEOUT_MS = 10_000;

/** What one ping came to. */
export interface NotifyPing {
  /** The feed the server was told about. */
  readonly url: string;
  /** Whether the server accepted it. */
  readonly ok: boolean;
  /** Why it did not, when it did not. */
  readonly error?: string;
}

/** What a round of pings came to, one entry per feed. */
export interface NotifyReport {
  /** Where the pings went, or `undefined` when the site names no server. */
  readonly server?: string;
  /** One entry per distinct feed, in the order they were sent. */
  readonly pings: readonly NotifyPing[];
}

/** Where a notifier reports what it could not do. `console` will do. */
export interface NotifyLogger {
  warn(message: string): void;
}

/** What {@link createFeedNotifier} needs. */
export interface CreateFeedNotifierOptions {
  /**
   * Config after defaults and environment overrides: the base URL, the clock a
   * scheduled post is held against, and the content directory the settings —
   * the notify server and the two archive bases — are read from.
   */
  config: Pick<ResolvedConfig, 'baseUrl' | 'contentDir' | 'now'>;
  /** Where failures are reported. Defaults to `console`. */
  logger?: NotifyLogger | undefined;
}

/**
 * Tells the site's notify server which feeds have changed.
 *
 * The server notifies nobody until it hears from the publisher, so a feed that
 * advertises a cloud and never pings it is a feed whose subscribers still
 * poll. This is the other half of the advertisement.
 *
 * Pings run one after another on a queue of their own and never throw: a
 * publish is not held up by a notification about it, and a server that is down
 * costs a line in the log rather than a save.
 */
export interface FeedNotifier {
  /**
   * Tell the server about these feeds, in order and without repeating one.
   * Absolute URLs, because it is going to fetch them.
   */
  notify(urls: readonly string[]): Promise<NotifyReport>;
  /**
   * Consider one index change and ping whatever feeds it moved.
   *
   * It returns as soon as the pings are queued rather than when they are
   * answered — the save is already done, and a notification about it is not
   * something the editor's redirect should wait for. Use
   * {@link FeedNotifier.settled} to wait for them.
   */
  handle(change: DocumentChange): void;
  /**
   * Which feeds a change moved: the site's three, and the three of every term
   * the post carried before or after it. Absolute, deduplicated, and empty
   * when the change moved no feed at all.
   */
  feedsFor(change: DocumentChange): string[];
  /** Resolve once every queued ping has finished, however it finished. */
  settled(): Promise<void>;
}

/**
 * Build the feed notifier for one site.
 *
 * The settings are read per ping rather than at boot, so moving the server on
 * the settings screen takes effect on the next publish rather than on the next
 * restart — the same way the feeds pick up the new address.
 */
export function createFeedNotifier(options: CreateFeedNotifierOptions): FeedNotifier {
  const { config } = options;
  const logger = options.logger ?? console;

  // Pings are chained rather than sent at once, and the chain never rejects:
  // one server that hangs delays the next ping and nothing else.
  let chain: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task);
    chain = result.then(ignore, ignore);
    return result;
  }

  /** The server the settings name, or `undefined` when they name none. */
  function server(): NotifyServer | undefined {
    return notifyEndpoints(readSiteSettings(config.contentDir).notifyServer);
  }

  /** Tell one server about one feed, answering with what happened. */
  async function ping(endpoint: NotifyServer, url: string): Promise<NotifyPing> {
    try {
      const response = await fetch(endpoint.ping, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({ url }).toString(),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      });

      if (!response.ok) {
        return { url, ok: false, error: `${endpoint.ping} answered ${String(response.status)}` };
      }
      return { url, ok: true };
    } catch (thrown) {
      return { url, ok: false, error: messageOf(thrown) };
    }
  }

  return {
    async notify(urls) {
      const endpoint = server();
      const wanted = [...new Set(urls)];
      if (endpoint === undefined || wanted.length === 0) return { pings: [] };

      return await enqueue(async () => {
        const sent: NotifyPing[] = [];
        for (const url of wanted) {
          const result = await ping(endpoint, url);
          if (!result.ok) {
            logger.warn(`Could not ping ${endpoint.ping} about ${url}: ${result.error ?? ''}`);
          }
          sent.push(result);
        }
        return { server: endpoint.base, pings: sent };
      });
    },

    feedsFor(change) {
      // A full scan is a rebuild of the index, not news about the site: the
      // boot scan reports a cold index as a directory full of creations, and
      // pinging for each would announce the whole archive every time somebody
      // deleted the database.
      if (change.origin === 'scan') return [];

      const now = config.now();
      const before = inFeeds(change.previous, now);
      const after = inFeeds(change.next, now);
      if (before === undefined && after === undefined) return [];

      const bases = taxonomyBasesFromSettings(readSiteSettings(config.contentDir));
      const urls = new Set<string>();

      for (const format of FEED_FORMATS) {
        urls.add(absoluteUrl(feedHref(undefined, format, bases), config.baseUrl));
      }
      // Both versions, because a post that left a tag changed that tag's feed
      // exactly as much as the one it joined.
      for (const term of termsOf(before, after)) {
        for (const format of FEED_FORMATS) {
          urls.add(absoluteUrl(feedHref(term, format, bases), config.baseUrl));
        }
      }

      return [...urls];
    },

    handle(change) {
      const urls = this.feedsFor(change);
      if (urls.length > 0) void this.notify(urls);
    },

    async settled() {
      await chain;
    },
  };
}

/**
 * The document if it appears in a feed, and `undefined` otherwise.
 *
 * The same predicate delivery uses, because it is the same question: a
 * published post is what goes to the followers and what goes in the feeds, and
 * a draft or a page is in neither.
 */
function inFeeds(document: Document | undefined, now: Date): Document | undefined {
  if (document === undefined) return undefined;
  return isFederatedDocument(document, now) ? document : undefined;
}

/** Every taxonomy term either version of a post carried, without repeats. */
function termsOf(before: Document | undefined, after: Document | undefined): TaxonomyTerm[] {
  const terms: TaxonomyTerm[] = [];
  const seen = new Set<string>();

  for (const document of [before, after]) {
    if (document === undefined) continue;
    for (const taxonomy of TAXONOMIES) {
      for (const term of taxonomy === 'tag' ? document.tags : document.categories) {
        const key = `${taxonomy}:${term}`;
        if (seen.has(key)) continue;
        seen.add(key);
        terms.push({ taxonomy, term });
      }
    }
  }

  return terms;
}

/** What a thrown value has to say for itself. */
function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function ignore(): void {
  // A failed ping is already logged; the chain carries on regardless.
}
