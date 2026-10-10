import { createHash } from 'node:crypto';

import { readSiteSettings } from '../admin/settings.ts';
import type {
  AdminStore,
  ConversationWrite,
  SentWebmention,
  WebmentionSendStatus,
} from '../admin/store.ts';
import type { CommentNotices, CommentRecords } from '../comments/records.ts';
import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import { holdOutbound } from '../dev-mode.ts';
import { citationsOf } from '../content/citation.ts';
import { isMigrated, isMigratedArrival } from '../content/migrated.ts';
import { readOf } from '../content/read.ts';
import { replyTarget } from '../content/post-type.ts';
import type { ContentStore } from '../content/store.ts';
import type { DocumentChange } from '../content/sync.ts';
import { isFederatedDocument } from '../federation/article.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import { discoverEndpoint, WEBMENTION_USER_AGENT } from './discovery.ts';
import { externalLinks, externalTarget } from './links.ts';
import { verifyWebmention } from './receive.ts';
import { selectedTargets, syndicationCopies, syndicationTargetsReader } from './syndication.ts';
import type { SyndicationTarget } from './syndication.ts';
import type { IncomingWebmention, WebmentionOutcome } from './receive.ts';
import { isWithheld } from '../web/conversation.ts';
import type { ConversationReader, ThreadReply, Upstream } from '../web/conversation.ts';

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

/**
 * How many salmentions one page sends one target in {@link SALMENTION_WINDOW_MS}
 * (TASK-320). Two sites that both send them, each answering the other, stop
 * on their own once neither has anything new; this is for one that never
 * settles, such as a page that prints something different every time it is
 * read.
 */
export const SALMENTION_LIMIT = 5;
export const SALMENTION_WINDOW_MS = 60 * 60 * 1000;

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
  config: Pick<
    ResolvedConfig,
    'baseUrl' | 'contentDir' | 'dataDir' | 'devMode' | 'now' | 'commentChecker'
  >;
  /** Where failures are reported. Defaults to `console`. */
  logger?: WebmentionLogger | undefined;
  /**
   * Who to tell when an incoming webmention lands in the queue (TASK-55).
   *
   * Handed straight to the intake, which decides whether this one is worth a
   * message. Optional, because a service built for a test of sending has
   * nobody to tell; the CMS always hands one in.
   */
  notifications?: CommentNotices | undefined;
  /**
   * The original a cited silo copy is of, from the stored reply contexts
   * (TASK-197). A reply to the copy tells the original too.
   */
  originalOf?: ((url: string) => string | undefined) | undefined;
  /**
   * What says which reply on a post an incoming webmention answers (TASK-319),
   * and which pages a salmention goes from (TASK-320).
   */
  conversation: Pick<ConversationReader, 'replyNamed' | 'upstreams' | 'documentOf'>;
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
   * Consider one comment or activity written to the index (TASK-320), and send
   * a salmention from each page whose replies it changed. Returns at once, as
   * {@link handle} does.
   */
  heard(written: ConversationWrite): void;
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
  /**
   * Tell `original` about every public post that replies to `copy`, once its
   * reply context has found that the copy is of it (TASK-197): the post was
   * sent before anybody knew.
   */
  originalFound(copy: string, original: string): void;
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
  const records: CommentRecords = {
    admin,
    contentDir: config.contentDir,
    dataDir: config.dataDir,
  };

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

  const targets = syndicationTargetsReader(config.contentDir);
  const originalOf = options.originalOf ?? (() => undefined);
  const copies = syndicationCopies(config.contentDir);

  /** The language a post that names none is in, as the file says now. */
  function siteLanguage(): string {
    return readSiteSettings(config.contentDir).language;
  }

  /**
   * Tell one page about one post, and answer with what happened and, when the
   * page made a copy of the post, where the copy is.
   */
  async function tell(slug: string, source: string, target: string): Promise<Told> {
    const endpoint = await discoverEndpoint(target);
    if (endpoint === undefined) {
      // Not a failure: most of the web takes no webmentions, and recording it
      // is what tells a person why nothing went.
      return { sent: record(slug, source, target, null, 'none', null) };
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
        return { sent: record(slug, source, target, endpoint, 'failed', error) };
      }

      return {
        sent: record(slug, source, target, endpoint, 'sent', null),
        copy: copyOf(response, endpoint),
      };
    } catch (thrown) {
      const error = messageOf(thrown);
      logger.warn(`Could not send a webmention for ${source}: ${error}`);
      return { sent: record(slug, source, target, endpoint, 'failed', error) };
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

  /** The URLs of the targets a version of a post selects. */
  function selectedUrls(document: Document | undefined): string[] {
    if (document === undefined) return [];
    return selectedTargets(document, targets(), siteLanguage()).map((target) => target.url);
  }

  function held(source: string, links: readonly string[]): boolean {
    return (
      links.length > 0 && holdOutbound(config, { kind: 'webmention', what: source, to: links })
    );
  }

  /** Tell every one of a post's targets, one after another. */
  async function tellAll(slug: string, source: string, links: readonly string[]): Promise<Told[]> {
    if (held(source, links)) return [];
    const outcomes: Told[] = [];
    for (const target of links) outcomes.push(await tell(slug, source, target));
    return outcomes;
  }

  /**
   * Bring the post's recorded copies in line with what was just sent
   * (decision-26): a target the post selects keeps the copy it answered with,
   * and one only an earlier version selected, or any of a post nobody can
   * read, claims none. A target's URL is the one it had for the version that
   * selected it, since it can follow the post's language (TASK-156).
   */
  async function keepCopies(
    permalink: string,
    versions: readonly (Document | undefined)[],
    current: Document | undefined,
    outcomes: readonly Told[],
  ): Promise<void> {
    const targeted = new Set(versions.flatMap((version) => selectedUrls(version)));
    const selected = new Set(selectedUrls(current));
    for (const { sent, copy } of outcomes) {
      if (!targeted.has(sent.target)) continue;
      if (!selected.has(sent.target)) await copies.write(permalink, sent.target, undefined);
      else if (copy !== undefined) await copies.write(permalink, sent.target, copy);
    }
  }

  // The documents whose conversations changed since the salmentions were
  // last looked at. A webmention carrying nested replies writes several
  // comments in a row, and they are looked at once.
  const changed = new Map<string, Document>();
  let looking = false;

  function conversationChanged(document: Document): void {
    changed.set(document.path, document);
    if (looking) return;
    looking = true;
    enqueue(async () => {
      looking = false;
      const documents = [...changed.values()];
      changed.clear();
      for (const one of documents) {
        for (const upstream of options.conversation.upstreams(one)) await salmention(upstream);
      }
    }).catch((thrown: unknown) => {
      logger.warn(`A salmention failed: ${messageOf(thrown)}`);
    });
  }

  /**
   * Tell what a page answers that the replies under it changed, when they did
   * since it was last told, and it has not been told too often lately.
   */
  async function salmention(upstream: Upstream): Promise<void> {
    const at = config.now();
    const fingerprint = fingerprintOf(upstream.replies);
    const targets = new Set(
      [upstream.target, originalOf(upstream.target)].flatMap((url) => {
        const target = externalTarget(url, config.baseUrl);
        return target === undefined ? [] : [target];
      }),
    );
    for (const target of targets) {
      const key = `salmention:${upstream.source} ${target}`;
      const recorded = admin.getState(key);
      // A post brought over from another site arrives with the replies it
      // already had, which are not news to anybody: they are where it starts.
      if (recorded === undefined && isMigrated(upstream.post)) {
        admin.setState(key, JSON.stringify({ fingerprint, sent: [] }));
        continue;
      }
      const told = toldOf(recorded);
      if (told.fingerprint === fingerprint) continue;
      const recent = told.sent.filter(
        (sent) => at.getTime() - Date.parse(sent) < SALMENTION_WINDOW_MS,
      );
      if (recent.length >= SALMENTION_LIMIT) {
        logger.warn(
          `Not sending another salmention from ${upstream.source} to ${target} this hour.`,
        );
        continue;
      }
      if (held(upstream.source, [target])) continue;
      admin.setState(key, JSON.stringify({ fingerprint, sent: [...recent, at.toISOString()] }));
      await tell(upstream.post.slug, upstream.source, target);
    }
  }

  /** Tell whatever pages one change of a post moved, as {@link WebmentionService.handle} says. */
  function sendFor(change: DocumentChange): void {
    const now = config.now();
    const document = change.next ?? change.previous;
    if (document === undefined || isMigratedArrival(change, now)) return;

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
    const links = targetsOf(
      [change.previous, change.next],
      targets(),
      config.baseUrl,
      siteLanguage(),
      originalOf,
    );
    if (links.length === 0) return;

    // A post that moved is a new source to its targets, which answer with
    // their copies of it under its new permalink.
    const moved =
      change.previous !== undefined &&
      change.next !== undefined &&
      change.previous.permalink !== change.next.permalink
        ? change.previous.permalink
        : undefined;
    const current = isNowPublic ? change.next : undefined;

    enqueue(async () => {
      if (moved !== undefined) await copies.forget(moved);
      await keepCopies(
        document.permalink,
        [change.previous, change.next],
        current,
        await tellAll(document.slug, source, links),
      );
    }).catch((thrown: unknown) => {
      logger.warn(`A webmention failed: ${messageOf(thrown)}`);
    });
  }

  return {
    handle(change) {
      // A full scan is a rebuild of the index, not news about the site.
      if (change.origin === 'scan') return;
      if (!sending()) return;
      sendFor(change);
      // And a reply post edited, published or withdrawn changes the replies
      // under whatever it is in.
      for (const version of [change.previous, change.next]) {
        if (version !== undefined) conversationChanged(version);
      }
    },

    heard(written) {
      if (!sending()) return;
      const document =
        written.kind === 'comment'
          ? store.getBySlug(written.slug)
          : written.about
              .map((url) => options.conversation.documentOf(url))
              .find((found) => found !== undefined);
      if (document !== undefined) conversationChanged(document);
    },

    async send(slug) {
      const document = postBySlug(store, slug);
      if (document === undefined) return undefined;

      const source = absoluteUrl(document.permalink, config.baseUrl);
      if (!sending()) return { slug, source, sent: [] };

      const links = targetsOf([document], targets(), config.baseUrl, siteLanguage(), originalOf);

      return await enqueue(async () => {
        const outcomes = await tellAll(slug, source, links);
        const current = isPublic(document, config.now()) ? document : undefined;
        await keepCopies(document.permalink, [document], current, outcomes);
        return { slug, source, sent: outcomes.map((one) => one.sent) };
      });
    },

    receive(incoming) {
      const checked = checking.then(async (): Promise<WebmentionOutcome> => {
        try {
          const outcome = await verifyWebmention({
            incoming,
            records,
            dataDir: config.dataDir,
            baseUrl: config.baseUrl,
            conversation: options.conversation,
            checker: config.commentChecker,
            // The intake decides whether this one is news: a page that is
            // edited and re-sent updates the entry it made, and putting the
            // moderators through a message every time would make the notice
            // worth ignoring.
            notices: options.notifications,
            now: config.now(),
            logger,
          });

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

    originalFound(copy, original) {
      const target = externalTarget(original, config.baseUrl);
      if (target === undefined || !sending()) return;
      const now = config.now();
      for (const document of store.listAll()) {
        if (replyTarget(document) !== copy || !isPublic(document, now) || isMigrated(document)) {
          continue;
        }
        const source = absoluteUrl(document.permalink, config.baseUrl);
        if (held(source, [target])) continue;
        enqueue(() => tell(document.slug, source, target)).catch((thrown: unknown) => {
          logger.warn(`A webmention failed: ${messageOf(thrown)}`);
        });
      }
    },

    settled() {
      return Promise.all([chain, checking]).then(ignore);
    },
  };
}

/** What a page last told its target, and when it has told it lately. */
interface Salmentioned {
  readonly fingerprint: string;
  readonly sent: readonly string[];
}

/** The ledger entry as the state holds it; nothing recorded is no replies, never told. */
function toldOf(value: string | undefined): Salmentioned {
  const nothing: Salmentioned = { fingerprint: fingerprintOf([]), sent: [] };
  if (value === undefined) return nothing;
  try {
    const parsed = JSON.parse(value) as Partial<Salmentioned>;
    return {
      fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : '',
      sent: Array.isArray(parsed.sent) ? parsed.sent.filter((one) => typeof one === 'string') : [],
    };
  } catch {
    return nothing;
  }
}

/** What a reader sees under a page, as one value that changes when any of it does. */
function fingerprintOf(replies: readonly ThreadReply[]): string {
  const shape = (list: readonly ThreadReply[]): unknown[] =>
    list.map((reply) =>
      isWithheld(reply)
        ? [reply.id, shape(reply.replies)]
        : [
            reply.id,
            reply.url,
            reply.author.name,
            reply.content,
            reply.published.toISOString(),
            shape(reply.replies),
          ],
    );
  return createHash('sha256')
    .update(JSON.stringify(shape(replies)))
    .digest('hex');
}

/** One page told, and the copy of the post it made, when it said where. */
interface Told {
  readonly sent: SentWebmention;
  readonly copy?: string | undefined;
}

/**
 * Every external page any of these versions of a post links to, in order: the
 * post it replies to first, and the original that post is a copy of (TASK-197),
 * then what it reposts, likes, bookmarks or reads, then the links in its body,
 * then the syndication targets it selects, which the theme links to inside its
 * h-entry.
 */
function targetsOf(
  documents: readonly (Document | undefined)[],
  declared: readonly SyndicationTarget[],
  baseUrl: string,
  siteLanguage: string,
  originalOf: (url: string) => string | undefined,
): string[] {
  const targets = new Set<string>();

  for (const document of documents) {
    if (document === undefined) continue;
    const reply = externalTarget(replyTarget(document), baseUrl);
    if (reply !== undefined) {
      targets.add(reply);
      const original = externalTarget(originalOf(reply), baseUrl);
      if (original !== undefined) targets.add(original);
    }
    const cites = [
      ...citationsOf(document.extra).map(({ url }) => url),
      readOf(document.extra)?.of.url,
    ];
    for (const url of cites) {
      const cited = externalTarget(url, baseUrl);
      if (cited !== undefined) targets.add(cited);
    }
    for (const target of externalLinks(document.html, baseUrl)) targets.add(target);
    for (const target of selectedTargets(document, declared, siteLanguage)) targets.add(target.url);
  }

  return [...targets];
}

/**
 * Where a target says its copy of the post is: the `Location` of a 201 or 202,
 * as IndieNews and Bridgy Publish answer, resolved against the endpoint.
 */
function copyOf(response: Response, endpoint: string): string | undefined {
  if (response.status !== 201 && response.status !== 202) return undefined;
  const location = response.headers.get('location');
  if (location === null || location === '') return undefined;
  try {
    const url = new URL(location, endpoint);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
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
