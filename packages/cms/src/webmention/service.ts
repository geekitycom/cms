import { readSiteSettings } from '../admin/settings.ts';
import type {
  AdminStore,
  PostComment,
  SentWebmention,
  WebmentionSendStatus,
} from '../admin/store.ts';
import type { CommentRecords } from '../comments/records.ts';
import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import type { ContentStore } from '../content/store.ts';
import type { DocumentChange } from '../content/sync.ts';
import { isFederatedDocument } from '../federation/article.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import { discoverEndpoint, WEBMENTION_USER_AGENT } from './discovery.ts';
import { externalLinks } from './links.ts';
import { verifyWebmention } from './receive.ts';
import type { IncomingWebmention, WebmentionOutcome } from './receive.ts';

/**
 * Telling the pages a post links to that it links to them.
 *
 * The other half of the same conversation the fediverse carries: a post is
 * published, and everything it points at is asked whether it takes webmentions
 * and told if it does. It is driven by the same index changes delivery is —
 * a post saved in the editor and a post edited on disk are one thing here —
 * and, like delivery, it ignores a full scan: the boot scan reports a cold
 * index as a directory full of creations, and notifying every page the archive
 * has ever linked to every time somebody deleted the database would be a
 * denial of service with this site's name on it.
 *
 * What is recorded is a cache of outcomes, one row per (post, target), exactly
 * as `ap_deliveries` is (decision-9): the links themselves are in the post's
 * file, so a database thrown away costs the record of how it went and nothing
 * else — and {@link WebmentionSender.send} reads the file again rather than
 * replaying anything.
 */

/** How long one webmention POST is given before it is abandoned. */
export const SEND_TIMEOUT_MS = 10_000;

/** What one post's links came to. */
export interface WebmentionReport {
  /** The post they were in. */
  readonly slug: string;
  /** Its absolute URL, which is the `source` that was sent. */
  readonly source: string;
  /** One row per external link, in the order the post links to them. */
  readonly sent: readonly SentWebmention[];
}

/** Where a service reports what it could not do. `console` will do. */
export interface WebmentionLogger {
  warn(message: string): void;
}

/** What {@link createWebmentionService} needs. */
export interface CreateWebmentionServiceOptions {
  /** Where the outcomes are recorded, and where the comment index lives. */
  admin: AdminStore;
  /** The content index, which a resend reads the post out of. */
  store: ContentStore;
  /**
   * Config after defaults: the base URL, the content and data directories, the
   * clock, and the checker an incoming webmention is put through.
   */
  config: Pick<ResolvedConfig, 'baseUrl' | 'contentDir' | 'dataDir' | 'now' | 'commentChecker'>;
  /** Where failures are reported. Defaults to `console`. */
  logger?: WebmentionLogger | undefined;
  /**
   * Who to tell when an incoming webmention lands in the queue (TASK-55).
   *
   * Optional, because a service built for a test of sending has nobody to
   * tell; the CMS always hands one in.
   */
  notifications?: { pending(comment: PostComment): void } | undefined;
}

/** Sends a site's webmentions, takes the ones sent to it, and remembers both. */
export interface WebmentionService {
  /**
   * Consider one index change and tell whatever pages it moved. Returns as
   * soon as the sends are queued rather than when they are answered — a save
   * is not something a stranger's server should be able to hold up.
   */
  handle(change: DocumentChange): void;
  /**
   * Send one post's webmentions again, from the file as it now reads.
   *
   * Not "send those again": the links are read out of the post at the moment
   * this is called (decision-9), so a link added since the last publish goes
   * out and one taken out is told, which is what somebody pressing Resend is
   * asking for. `undefined` when no post answers to that slug.
   */
  send(slug: string): Promise<WebmentionReport | undefined>;
  /**
   * Take one webmention the endpoint has accepted and check it, out of the
   * request that brought it.
   *
   * Returns as soon as it is queued — the sender has already had its 202, and
   * fetching a stranger's page is not something a stranger's connection should
   * be held open for. The promise it hands back is for a test, or for a caller
   * that wants to know what became of one; nothing has to look at it.
   */
  receive(incoming: IncomingWebmention): Promise<WebmentionOutcome>;
  /** Resolve once every queued send and check has finished, however it finished. */
  settled(): Promise<void>;
}

/** Build the webmention service for one site. */
export function createWebmentionService(
  options: CreateWebmentionServiceOptions,
): WebmentionService {
  const { admin, store, config } = options;
  const logger = options.logger ?? console;

  /** The comment files an incoming webmention is written into. */
  const records: CommentRecords = { admin, contentDir: config.contentDir };

  // Incoming checks run one after another too, and on a chain of their own: a
  // page of this site's own that is slow to answer must not hold up the check
  // on a webmention somebody is waiting to see appear.
  let checking: Promise<unknown> = Promise.resolve();

  // Sends are chained rather than run at once, and the chain never rejects:
  // one page that hangs delays the next and nothing else.
  let chain: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task);
    chain = result.then(ignore, ignore);
    return result;
  }

  /** Whether the site is sending webmentions at all, as the file says now. */
  function sending(): boolean {
    return readSiteSettings(config.contentDir).webmentionsSend;
  }

  /** Tell one page about one post, and answer with what happened. */
  async function tell(slug: string, source: string, target: string): Promise<SentWebmention> {
    const endpoint = await discoverEndpoint(target);
    if (endpoint === undefined) {
      // Not a failure: most of the web takes no webmentions, and recording it
      // is what tells a person why nothing went.
      return record(slug, source, target, null, 'none', null);
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'text/html, application/json;q=0.9, */*;q=0.8',
          'user-agent': WEBMENTION_USER_AGENT,
        },
        body: new URLSearchParams({ source, target }).toString(),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      if (!response.ok) {
        const error = `${endpoint} answered ${String(response.status)}`;
        logger.warn(`Could not send a webmention for ${source}: ${error}`);
        return record(slug, source, target, endpoint, 'failed', error);
      }

      return record(slug, source, target, endpoint, 'sent', null);
    } catch (thrown) {
      const error = messageOf(thrown);
      logger.warn(`Could not send a webmention for ${source}: ${error}`);
      return record(slug, source, target, endpoint, 'failed', error);
    }
  }

  /** Write one outcome down. */
  function record(
    slug: string,
    source: string,
    target: string,
    endpoint: string | null,
    status: WebmentionSendStatus,
    error: string | null,
  ): SentWebmention {
    return admin.recordSentWebmention({ slug, source, target, endpoint, status, error });
  }

  /** Tell every one of a post's targets, one after another. */
  async function tellAll(
    slug: string,
    source: string,
    targets: readonly string[],
  ): Promise<SentWebmention[]> {
    const outcomes: SentWebmention[] = [];
    for (const target of targets) outcomes.push(await tell(slug, source, target));
    return outcomes;
  }

  return {
    handle(change) {
      // A full scan is a rebuild of the index, not news about the site.
      if (change.origin === 'scan') return;
      if (!sending()) return;

      const now = config.now();
      const document = change.next ?? change.previous;
      if (document === undefined) return;

      // Nothing goes out about a post the outside world has never been able to
      // read: a draft edited into another draft is not news.
      const wasPublic = isPublic(change.previous, now);
      const isNowPublic = isPublic(change.next, now);
      if (!wasPublic && !isNowPublic) return;

      // Both versions' links, because a page that has just been unlinked has
      // to be told too: it goes and looks, finds the link gone, and drops what
      // it was showing. That is how a webmention is withdrawn — there is no
      // other way to say it.
      const source = absoluteUrl(document.permalink, config.baseUrl);
      const targets = targetsOf([change.previous, change.next], config.baseUrl);
      if (targets.length === 0) return;

      enqueue(() => tellAll(document.slug, source, targets)).catch((thrown: unknown) => {
        logger.warn(`A webmention failed: ${messageOf(thrown)}`);
      });
    },

    async send(slug) {
      const document = postBySlug(store, slug);
      if (document === undefined) return undefined;

      const source = absoluteUrl(document.permalink, config.baseUrl);
      if (!sending()) return { slug, source, sent: [] };

      const targets = targetsOf([document], config.baseUrl);

      return await enqueue(async () => ({
        slug,
        source,
        sent: await tellAll(slug, source, targets),
      }));
    },

    receive(incoming) {
      const checked = checking.then(async (): Promise<WebmentionOutcome> => {
        try {
          const outcome = await verifyWebmention({
            incoming,
            records,
            dataDir: config.dataDir,
            baseUrl: config.baseUrl,
            checker: config.commentChecker,
            now: config.now(),
            logger,
          });

          // Only a webmention this site had not already stored is news: a page
          // that is edited and re-sent updates the entry it made, and putting
          // the moderators through a message every time it happens would make
          // the notice worth ignoring.
          if (outcome.kind === 'stored' && outcome.created) {
            options.notifications?.pending(outcome.comment);
          }

          return outcome;
        } catch (thrown) {
          // Nothing is waiting for this: the sender has had its 202, so a
          // failure has nowhere to go but the log, and it must not become an
          // unhandled rejection that takes the process down.
          const reason = messageOf(thrown);
          logger.warn(`A webmention from ${incoming.source} could not be checked: ${reason}`);
          return { kind: 'unreachable', reason };
        }
      });
      checking = checked;
      return checked;
    },

    settled() {
      return Promise.all([chain, checking]).then(ignore);
    },
  };
}

/** Every external page any of these versions of a post links to, in order. */
function targetsOf(documents: readonly (Document | undefined)[], baseUrl: string): string[] {
  const targets = new Set<string>();

  for (const document of documents) {
    if (document === undefined) continue;
    for (const target of externalLinks(document.html, baseUrl)) targets.add(target);
  }

  return [...targets];
}

/** Whether a version of a document was one a stranger could read. */
function isPublic(document: Document | undefined, now: Date): boolean {
  return document !== undefined && isFederatedDocument(document, now);
}

/**
 * The post a slug names, the trash included, or `undefined`.
 *
 * The same lookup a resend of an ActivityPub delivery does, and for the same
 * reason: the newest document of that name is the post nine times out of ten,
 * and the federated list is the fallback for a trashed one standing behind a
 * live page.
 */
function postBySlug(store: ContentStore, slug: string): Document | undefined {
  const direct = store.getBySlug(slug);
  if (direct !== undefined) return direct;
  return store.listFederated().find((document) => document.slug === slug);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ignore(): void {
  // Deliberately empty: the chain must not reject, and every failure is
  // already recorded against the target it happened to.
}
