import type { ResolvedConfig } from './config.ts';
import type { Document } from './content/document.ts';
import { isMigratedArrival } from './content/migrated.ts';
import { holdOutbound } from './dev-mode.ts';
import type { SettingsRegistry } from './settings/types.ts';
import type { DocumentChange } from './content/sync.ts';
import { readSiteSettings } from './site/site-json.ts';
import { messageOf } from './util/errors.ts';
import { createSerialQueue } from './util/queue.ts';
import { retry } from './util/retry.ts';
import { absoluteUrl } from './util/url.ts';
import { isPrivateHost } from './util/public-address.ts';
import { isListed } from './content/served.ts';
import { indexNowKeyPath } from './site/indexnow-key.ts';

/** The shared endpoint: a submission here reaches every IndexNow engine. */
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/** The most URLs one request may carry. */
const MAX_URLS_PER_REQUEST = 10_000;

const DEFAULT_BATCH_MS = 10_000;
const DEFAULT_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

/** Ten seconds, then forty: an engine that answered 429 wants the site to slow down. */
export function defaultIndexNowBackoffMs(attempt: number): number {
  return attempt * attempt * 10_000;
}

/** What {@link createIndexNowNotifier} needs. */
export interface CreateIndexNowNotifierOptions {
  config: Pick<ResolvedConfig, 'baseUrl' | 'contentDir' | 'dataDir' | 'now' | 'indexNow'>;
  settings: SettingsRegistry;
}

/**
 * Tells the IndexNow engines which URLs changed (TASK-151).
 *
 * Changes are gathered for a few seconds and sent as one request, on a queue
 * of their own, and a failure is retried and then logged rather than thrown:
 * a save is never held up by a search engine, and an engine that is down costs
 * a line in the log.
 */
export interface IndexNowNotifier {
  /**
   * The absolute URLs a change moved: the public version's permalink before
   * and after, so a deletion and a move are submitted as well as a publish.
   * Empty for a full scan, a draft, and a site that is not sending.
   */
  urlsFor(change: DocumentChange): string[];
  /** Gather a change's URLs into the next batch. Returns at once. */
  handle(change: DocumentChange): void;
  /** Send what has been gathered now, and resolve once every batch has finished. */
  settled(): Promise<void>;
  /** Stop the batch timer. What was gathered and not sent is dropped. */
  close(): void;
}

/** What a site needs to send: IndexNow on, a key, and a base URL the engines can reach. */
interface Sending {
  key: string;
  host: string;
  keyLocation: string;
}

export function createIndexNowNotifier(options: CreateIndexNowNotifierOptions): IndexNowNotifier {
  const { config, settings } = options;
  const overrides = config.indexNow;
  const send = overrides.fetch ?? ((input, init) => fetch(input, init));
  const endpoint = overrides.endpoint ?? INDEXNOW_ENDPOINT;
  const batchMs = overrides.batchMs ?? DEFAULT_BATCH_MS;
  const attempts = overrides.attempts ?? DEFAULT_ATTEMPTS;
  const backoffMs = overrides.backoffMs ?? defaultIndexNowBackoffMs;
  const logger = overrides.logger ?? console;

  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const batches = createSerialQueue();

  /** Read per batch, so the settings screen takes effect on the next publish. */
  function sending(): Sending | undefined {
    const settings = readSiteSettings(config.contentDir);
    if (!settings.indexNow || settings.indexNowKey === '') return undefined;
    const host = new URL(config.baseUrl).hostname;
    if (isPrivateHost(host)) return undefined;
    return {
      key: settings.indexNowKey,
      host,
      keyLocation: absoluteUrl(indexNowKeyPath(settings.indexNowKey), config.baseUrl),
    };
  }

  function flush(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (pending.size === 0) return;

    const urls = [...pending];
    pending.clear();
    void batches.run(() => submit(urls)).catch(ignore);
  }

  async function submit(urls: readonly string[]): Promise<void> {
    const target = sending();
    if (target === undefined) return;

    for (let start = 0; start < urls.length; start += MAX_URLS_PER_REQUEST) {
      const urlList = urls.slice(start, start + MAX_URLS_PER_REQUEST);
      if (
        await holdOutbound(settings, config, {
          kind: 'indexnow',
          what: urlList.join(' '),
          to: [endpoint],
        })
      ) {
        continue;
      }
      const failure = await post({ ...target, urlList });
      if (failure !== undefined) {
        logger.warn(`Could not submit ${String(urlList.length)} URLs to ${endpoint}: ${failure}`);
      }
    }
  }

  /** One batch, tried until it is accepted, refused, or out of attempts. Answers why it failed. */
  function post(body: Sending & { urlList: string[] }): Promise<string | undefined> {
    return retry({ attempts, backoffMs }, async () => {
      try {
        const response = await send(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.ok) return { value: undefined, retry: false };
        // A bad key or a URL from another host is not fixed by asking again.
        return {
          value: `${endpoint} answered ${String(response.status)}`,
          retry: response.status === 429 || response.status >= 500,
        };
      } catch (thrown) {
        return { value: messageOf(thrown), retry: true };
      }
    });
  }

  return {
    urlsFor(change) {
      // A full scan is a rebuilt index, not news: submitting it would announce
      // the whole archive every time somebody deleted the database.
      if (change.origin === 'scan' || sending() === undefined) return [];

      const now = config.now();
      if (isMigratedArrival(change, now)) return [];
      const urls = new Set<string>();
      for (const document of [change.previous, change.next]) {
        const url = publicUrl(document, now, config.baseUrl);
        if (url !== undefined) urls.add(url);
      }
      return [...urls];
    },

    handle(change) {
      const urls = this.urlsFor(change);
      if (urls.length === 0) return;
      for (const url of urls) pending.add(url);
      if (timer === undefined) {
        timer = setTimeout(flush, batchMs);
        timer.unref();
      }
    },

    async settled() {
      flush();
      await batches.settled();
    },

    close() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending.clear();
    },
  };
}

/** The document's absolute URL while the public site shows it, and `undefined` otherwise. */
function publicUrl(document: Document | undefined, now: Date, baseUrl: string): string | undefined {
  if (document === undefined || !isListed(document, now)) return undefined;
  return absoluteUrl(document.permalink, baseUrl);
}

function ignore(): void {}
