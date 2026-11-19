import { rsvpField } from '../store/admin-store.ts';
import type { PostComment } from '../store/admin-store.ts';
import { heldWebmention, intakeComment } from '../comments/intake.ts';
import type { CommentNotices, ProposedComment } from '../comments/intake.ts';
import { deleteComment, isCarried } from '../comments/records.ts';
import type { CommentRecords } from '../comments/records.ts';
import type { CommentChecker } from '../forms/checker.ts';
import type { Document } from '../content/document.ts';
import { postLabel } from '../content/post-type.ts';
import { escapeText } from '../util/html.ts';
import { commentKeyAt } from '../comments/conversation.ts';
import type { ConversationReader, ConversationSite } from '../comments/conversation.ts';
import { sanitizeCommentHtml } from '../content/sanitize.ts';
import { DISCOVERY_MAX_BYTES } from './discovery.ts';
import { decodeBody, fetchPublic } from './fetch-public.ts';
import { linksIn, linksTo, sourceEntry } from './microformats.ts';
import type { NestedReply, SourceEntry } from './microformats.ts';
import { handSyndicationOf, syndicationCopies } from './syndication.ts';
import { isPrivateHost } from '../util/public-address.ts';
import type { HostLookup } from '../util/public-address.ts';
import { decodedPath } from '../util/url.ts';

/**
 * Taking a webmention somebody sent this site.
 *
 * Two steps, and the split is the whole design. The endpoint decides in one
 * request whether the thing it was handed could possibly be a webmention —
 * two http URLs, not the same one, the target a page here — and answers 202 or
 * 400 without touching the network. Everything that needs somebody else's
 * server is done afterwards, out of the request: fetching the source, checking
 * that it really links here, reading its microformats, and putting the result
 * in the moderation queue.
 *
 * That is why a source that turns out to say nothing about this site still
 * gets a 202. The spec allows exactly this, and the alternative — holding the
 * connection open while a stranger's server is fetched — is a way of being
 * held open by a stranger's server.
 *
 * What lands is a comment like any other, and it lands the same way:
 * this module reads what the source says and hands `intakeComment` a proposed
 * comment, so the file, the index, the {@link CommentChecker} seam, the
 * verdict-to-status rule and the notice are the very ones a form submission
 * gets. That is how it reaches Akismet as a `webmention` without this
 * module knowing Akismet exists, and how a moderator's decision on a mention
 * survives the page that sent it being edited and re-sent.
 *
 * What it is not held by is the closing rules: a post that stopped taking
 * comments a year ago still hears about a page that links to it, exactly as it
 * still hears a fediverse reply, because neither is something this site can
 * stop happening.
 */

/** How long the source is given to answer before it is abandoned. */
export const VERIFY_TIMEOUT_MS = 15_000;

/** One webmention as it arrived, before anything has been fetched. */
export interface IncomingWebmention {
  /** The page claiming to link here. */
  readonly source: string;
  /** The page on this site it claims to link to. */
  readonly target: string;
  /** The post that target names. */
  readonly document: Document;
  /** Where the request came from, **unhashed**, for the checker. */
  readonly address?: string | undefined;
  /** The `User-Agent` the sender sent. */
  readonly userAgent?: string | undefined;
  /** The `Referer` the sender sent. */
  readonly referrer?: string | undefined;
}

/** What one submitted pair turned out to be. */
export type WebmentionRequest =
  /** Worth checking: the target is a page here and the source might link to it. */
  | {
      readonly ok: true;
      readonly source: string;
      readonly target: string;
      readonly document: Document;
    }
  /** Not a webmention at all, with the reason a sender is told. */
  | { readonly ok: false; readonly problem: RequestProblem; readonly message: string };

/**
 * Which half of a refused pair was wrong, which a pingback's fault code is read
 * off: the source, a target that is no page here, a target on somebody else's
 * site, or a pair that names one page twice.
 */
export type RequestProblem = 'source' | 'target' | 'elsewhere' | 'same';

/** What {@link checkWebmentionRequest} needs to answer. */
export interface CheckWebmentionOptions {
  /** The site's public origin. */
  readonly baseUrl: string;
  /** The public document one of this site's paths names, or `undefined`. */
  readonly documentAt: (pathname: string) => Document | undefined;
  /** The public post a URL elsewhere is one of the syndicated copies of. */
  readonly syndicatedAt?: ((url: string) => Document | undefined) | undefined;
  /** What says which post a comment's own page is on. */
  readonly conversation: Pick<ConversationReader, 'comment'>;
  readonly site: ConversationSite;
}

/**
 * Whether a submitted `source` and `target` are worth going and looking at.
 *
 * Everything here is decided from the two strings and this site's own index —
 * nothing is fetched — because this is what a 400 has to be decided from: the
 * spec wants a synchronous answer, and a synchronous answer must not depend on
 * a stranger's server.
 */
export function checkWebmentionRequest(
  source: string,
  target: string,
  options: CheckWebmentionOptions,
): WebmentionRequest {
  if (source.trim() === '') return refuse('source', 'A webmention needs a source.');
  if (target.trim() === '') return refuse('target', 'A webmention needs a target.');

  const from = webUrl(source);
  const to = webUrl(target);
  if (from === undefined) return refuse('source', 'The source is not an http or https URL.');
  if (to === undefined) return refuse('target', 'The target is not an http or https URL.');
  from.hash = '';
  to.hash = '';
  if (from.href === to.href) {
    return refuse('same', 'The source and the target are the same page.');
  }

  if (isPrivateHost(from.hostname)) return refuse('source', 'The source is not a public URL.');

  const site = webUrl(options.baseUrl);
  if (site !== undefined && isThisSite(from, site)) {
    return refuse('source', 'The source is a page on this site.');
  }
  if (site === undefined || !isThisSite(to, site)) {
    const original = options.syndicatedAt?.(to.href);
    if (original !== undefined) {
      return { ok: true, source: from.href, target: to.href, document: original };
    }
    return refuse('elsewhere', 'The target is not a page on this site.');
  }

  if (to.search !== '') return refuse('target', 'There is no page here at that address.');

  // A comment's page is a page here, and what is said to it is said on the
  // post it is under.
  const path = decodedPath(to.pathname);
  const key = commentKeyAt(path);
  const pathname =
    key === undefined ? path : options.conversation.comment(key, options.site)?.post.permalink;
  const document = pathname === undefined ? undefined : options.documentAt(pathname);
  if (document === undefined) return refuse('target', 'There is no page here at that address.');

  return { ok: true, source: from.href, target: to.href, document };
}

function isThisSite(url: URL, site: URL): boolean {
  return url.origin === site.origin;
}

/** What {@link verifyWebmention} needs around it. */
export interface VerifyWebmentionOptions {
  /** The webmention to check. */
  readonly incoming: IncomingWebmention;
  /** The comment files and the index over them. */
  readonly records: CommentRecords;
  /** Where the address salt lives. */
  readonly dataDir: string;
  /** The site's public origin. */
  readonly baseUrl: string;
  /** What says which reply on the post a source answers, and which post a comment's page is on. */
  readonly conversation: Pick<ConversationReader, 'replyNamed' | 'comment'>;
  readonly site: ConversationSite;
  /** The checker, when the site named one. */
  readonly checker?: CommentChecker | undefined;
  /** Who to tell when one lands in the queue, handed to the intake. */
  readonly notices?: CommentNotices | undefined;
  /** The clock. */
  readonly now: Date;
  readonly lookup: HostLookup;
  /** Where failures are reported. */
  readonly logger: { warn(message: string): void };
}

/** What became of one verification. */
export type WebmentionOutcome =
  /**
   * The source links here and the comment was written or rewritten.
   *
   * `created` says which. A page that sends its webmention again every time it
   * is edited would otherwise put the moderators through a notification each
   * time, for an entry that has been in the queue all along.
   */
  | { readonly kind: 'stored'; readonly comment: PostComment; readonly created: boolean }
  /** Nothing is stored from the source any more, and what it left is gone. */
  | { readonly kind: 'deleted'; readonly why: NotStored }
  /** Nothing is stored from the source, and there was nothing to remove. */
  | { readonly kind: 'ignored'; readonly why: NotStored }
  /** The source could not be read this time; whatever is stored stands. */
  | { readonly kind: 'unreachable'; readonly reason: string };

/**
 * Go and look at the source, and put what it says in the queue.
 *
 * The three endings are the three things a source can be. A page that links
 * here is stored, or rewritten where this site already has one from it — the
 * source URL is the identity, so a blog post edited and re-sent updates its
 * comment instead of adding a second. A page that has stopped linking here, or
 * that has gone, takes its comment with it, which is the only way a webmention
 * can be withdrawn. A page that could not be read at all changes nothing: a
 * server having a bad afternoon must not delete what it said last week.
 */
export async function verifyWebmention(
  options: VerifyWebmentionOptions,
): Promise<WebmentionOutcome> {
  const { incoming, records, now } = options;
  const held = heldWebmention(records, incoming.document.slug, incoming.source);

  const fetched = await readSource(incoming.source, options.lookup);
  if (fetched.kind === 'unreachable') {
    options.logger.warn(
      `Could not read ${incoming.source} to verify a webmention: ${fetched.reason}`,
    );
    return { kind: 'unreachable', reason: fetched.reason };
  }

  if (fetched.kind === 'read' && fetched.truncated && !mentions(fetched, incoming)) {
    const reason = 'the link was not in the part of the page that was read';
    options.logger.warn(`Could not read all of ${incoming.source} to verify a webmention`);
    return { kind: 'unreachable', reason };
  }

  if (fetched.kind === 'gone' || !mentions(fetched, incoming)) {
    if (fetched.kind === 'read' && namesThePost(fetched, options)) {
      return { kind: 'ignored', why: 'unlinked' };
    }
    const why = fetched.kind === 'gone' ? 'gone' : 'unlinked';
    await dropCarried(records, incoming, new Set());
    if (held === undefined || isCarried(held)) return { kind: 'ignored', why };
    await deleteComment(records, held.id);
    return { kind: 'deleted', why };
  }

  const isUrlOfPost = urlOfPost(options);
  const entry =
    fetched.format === 'html'
      ? sourceEntry(
          fetched.body,
          fetched.url,
          (url) => url === incoming.target || isUrlOfPost(url),
          now,
        )
      : // A source that is not HTML — plain text, JSON, anything — has no
        // microformats to read, so all that can be said about it is that it
        // links here.
        undefined;

  if (held !== undefined && isCarried(held) && !isOwnPage(incoming.source, fetched.url, entry)) {
    return { kind: 'stored', comment: held, created: false };
  }

  // The first of the things it answers that is a reply on this post. A source
  // answering one is a reply here even when it never names the post itself.
  const inReplyTo = answered(options, entry?.inReplyTo ?? []);
  const kind = inReplyTo === null ? (entry?.kind ?? 'mention') : 'reply';
  const author = {
    name:
      entry?.author.name !== undefined && entry.author.name !== ''
        ? entry.author.name
        : hostOf(incoming.source),
    url: entry?.author.url ?? null,
    email: null,
    avatar: entry?.author.photo ?? null,
  };
  // A like and a repost say nothing: the page's title is a title, not a
  // comment, and printing it under a post as though somebody wrote it would be
  // putting words in their mouth.
  const wordless = kind === 'like' || kind === 'repost';
  const text = wordless ? '' : (entry?.content.text ?? '');
  const html = wordless
    ? ''
    : entry !== undefined && entry.content.html !== ''
      ? sanitizeCommentHtml(entry.content.html)
      : paragraph(text);

  const proposed: ProposedComment = {
    slug: incoming.document.slug,
    permalink: incoming.document.permalink,
    source: 'webmention',
    kind,
    author,
    content: { markdown: text, html },
    submitted: entry?.published ?? held?.submitted ?? now.toISOString(),
    inReplyTo,
    // The URL it was sent from rather than the entry's own `u-url`: this is
    // the identity a later webmention is matched against, and the sender is
    // the one who chose it.
    url: incoming.source,
    // A page has nobody to ask, and no address to ask them at.
    notify: false,
    ...rsvpField(entry?.rsvp),
  };

  const outcome = await intakeComment({
    records,
    origin: 'webmention',
    comment: proposed,
    // The target as its sender named it, rather than this site's own idea of
    // the permalink: that is the URL the conversation is about.
    post: { title: postLabel(incoming.document), url: incoming.target },
    dataDir: options.dataDir,
    baseUrl: options.baseUrl,
    checker: options.checker,
    notices: options.notices,
    address: incoming.address,
    userAgent: incoming.userAgent,
    referrer: incoming.referrer,
    logger: options.logger,
  });

  if (outcome.kind === 'stored') {
    await keepCarried(options, outcome.comment, entry?.replies ?? []);
    return { kind: 'stored', comment: outcome.comment, created: outcome.created };
  }
  await dropCarried(records, incoming, new Set());
  // A source nobody was holding anything from leaves nothing behind, and one
  // whose entry went while this was deciding has already been dealt with.
  return outcome.kind === 'discarded' && outcome.removed
    ? { kind: 'deleted', why: 'discarded' }
    : { kind: 'ignored', why: 'discarded' };
}

function answered(options: VerifyWebmentionOptions, urls: readonly string[]): string | null {
  for (const url of urls) {
    const named = options.conversation.replyNamed(options.incoming.document, url, options.site);
    if (named !== undefined) return named.id;
  }
  return null;
}

/** Whether `source` (which has no fragment by now) is the reply's own page. */
function isOwnPage(source: string, fetchedUrl: string, entry: SourceEntry | undefined): boolean {
  return fetchedUrl === source || entry?.url === source;
}

/**
 * Bring the replies a source carries in its h-entry into the thread under it
 * (a salmention), and take away the ones it carried before and
 * carries no longer.
 *
 * Each is a webmention of its own as far as the thread and the moderator are
 * concerned, put through the same intake with its own page as its `url`, and
 * `via` naming the source, which is what lets the source take it away again.
 * One this site already has some other way is not copied: a page of this
 * site's, a reply post or a comment's page, or a reply the conversation
 * already names that this source did not bring, such as one held from its own
 * webmention. What is nested under one of those still threads under it.
 */
async function keepCarried(
  options: VerifyWebmentionOptions,
  carrier: PostComment,
  replies: readonly NestedReply[],
): Promise<void> {
  const { incoming, records } = options;
  const site = new URL(options.baseUrl).origin;
  const kept = new Set<string>();

  const bring = async (nested: readonly NestedReply[], parent: string): Promise<void> => {
    for (const reply of nested) {
      const named = options.conversation.replyNamed(incoming.document, reply.url, options.site)?.id;
      const theirs =
        named !== undefined && records.admin.getComment(named)?.via === incoming.source;
      let id = named;
      if (new URL(reply.url).origin !== site && (named === undefined || theirs)) {
        const outcome = await intakeComment({
          records,
          origin: 'webmention',
          comment: carriedComment(options, reply, parent),
          post: { title: postLabel(incoming.document), url: incoming.target },
          dataDir: options.dataDir,
          baseUrl: options.baseUrl,
          checker: options.checker,
          notices: options.notices,
          address: incoming.address,
          userAgent: incoming.userAgent,
          referrer: incoming.referrer,
          logger: options.logger,
        });
        id = outcome.kind === 'stored' ? outcome.comment.id : undefined;
        if (id !== undefined) kept.add(id);
      }
      if (id !== undefined) await bring(reply.replies, id);
    }
  };

  await bring(replies, carrier.id);
  await dropCarried(records, incoming, kept);
}

/** Delete what a source carried, but for the ones in `kept`. */
async function dropCarried(
  records: CommentRecords,
  incoming: IncomingWebmention,
  kept: ReadonlySet<string>,
): Promise<void> {
  for (const comment of records.admin.listCommentsFor(incoming.document.slug)) {
    if (comment.via === incoming.source && !kept.has(comment.id)) {
      await deleteComment(records, comment.id);
    }
  }
}

/** One nested reply as the comment it is proposed as. */
function carriedComment(
  options: VerifyWebmentionOptions,
  reply: NestedReply,
  parent: string,
): ProposedComment {
  const { incoming } = options;
  return {
    slug: incoming.document.slug,
    permalink: incoming.document.permalink,
    source: 'webmention',
    kind: 'reply',
    author: {
      name: reply.author.name === '' ? hostOf(reply.url) : reply.author.name,
      url: reply.author.url,
      email: null,
      avatar: reply.author.photo,
    },
    content: {
      markdown: reply.content.text,
      html:
        reply.content.html === ''
          ? paragraph(reply.content.text)
          : sanitizeCommentHtml(reply.content.html),
    },
    submitted:
      reply.published ??
      heldWebmention(options.records, incoming.document.slug, reply.url)?.submitted ??
      options.now.toISOString(),
    inReplyTo: parent,
    url: reply.url,
    via: incoming.source,
    notify: false,
  };
}

/**
 * Why a source left nothing behind: it is not there, it does not link here, or
 * it was thrown away, by the checker or by a moderator deleting the entry while
 * this was deciding. A pingback is told which; a webmention, answered before
 * any of it was known, never is.
 */
export type NotStored = 'gone' | 'unlinked' | 'discarded';

type SourceFormat = 'html' | 'json' | 'text';

/** What reading a source page came to. */
type FetchedSource =
  | { kind: 'read'; body: string; url: string; format: SourceFormat; truncated: boolean }
  | { kind: 'gone' }
  /** Not readable this time, which is not the same thing at all. */
  | { kind: 'unreachable'; reason: string };

/** Fetch a source page, following redirects and reading no more than a page. */
async function readSource(source: string, lookup: HostLookup): Promise<FetchedSource> {
  const fetched = await fetchPublic(source, {
    lookup,
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    maxBytes: DISCOVERY_MAX_BYTES,
    overflow: 'truncate',
    accept: 'text/html, */*;q=0.8',
    contentType: { pattern: /^/, name: 'anything' },
  });

  if (!fetched.ok) {
    if (fetched.status === 404 || fetched.status === 410) return { kind: 'gone' };
    return { kind: 'unreachable', reason: fetched.reason };
  }

  return {
    kind: 'read',
    body: decodeBody(fetched.body, fetched.type),
    url: fetched.url,
    format: formatOf(fetched.type),
    truncated: fetched.truncated,
  };
}

function formatOf(type: string): SourceFormat {
  if (/^\s*(text\/html|application\/xhtml\+xml)/i.test(type)) return 'html';
  if (/^\s*application\/([\w.-]+\+)?json\s*(;|$)/i.test(type)) return 'json';
  return 'text';
}

/**
 * Whether what was read really links to the target.
 *
 * HTML is parsed, because a link is a link and the target written out in the
 * prose is not one. Anything else has no links, so it is read for the URLs it
 * names, as {@link urlsNamedIn} finds them.
 */
function mentions(
  fetched: { body: string; url: string; format: SourceFormat },
  incoming: IncomingWebmention,
): boolean {
  if (fetched.format === 'html') return linksTo(fetched.body, fetched.url, incoming.target);
  const wanted = webUrl(incoming.target);
  return wanted !== undefined && urlsNamedIn(fetched).has(wanted.href);
}

function namesThePost(
  fetched: { body: string; url: string; format: SourceFormat },
  options: VerifyWebmentionOptions,
): boolean {
  const named =
    fetched.format === 'html' ? linksIn(fetched.body, fetched.url) : urlsNamedIn(fetched);
  return [...named].some(urlOfPost(options));
}

/**
 * The URLs a source that is not HTML names, normalised and less any fragment.
 *
 * A JSON value names a URL only when the whole string is one, so an endpoint
 * that echoes a longer URL back names nothing. Plain text, and JSON too broken
 * to parse, names a URL that stands on its own between spaces, quotes or
 * brackets, less any full stop or comma that ends the sentence.
 */
function urlsNamedIn(fetched: { body: string; format: SourceFormat }): Set<string> {
  const candidates =
    (fetched.format === 'json' ? jsonStrings(fetched.body) : undefined) ??
    (fetched.body.match(/https?:\/\/[^\s"'`<>()\\]+/gi) ?? []).map((url) =>
      url.replace(/[.,;:!?]+$/, ''),
    );

  const named = new Set<string>();
  for (const candidate of candidates) {
    const url = webUrl(candidate);
    if (url === undefined) continue;
    url.hash = '';
    named.add(url.href);
  }
  return named;
}

/** Every string value in a JSON document, or `undefined` when it does not parse. */
function jsonStrings(body: string): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  const strings: string[] = [];
  const pending: unknown[] = [parsed];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === 'string') strings.push(value);
    else if (typeof value === 'object' && value !== null) {
      for (const inner of Object.values(value)) pending.push(inner);
    }
  }
  return strings;
}

function urlOfPost(options: VerifyWebmentionOptions): (href: string) => boolean {
  const { document } = options.incoming;
  const origin = new URL(options.baseUrl).origin;
  let copies: string[] | undefined;

  return (href) => {
    const url = webUrl(href);
    if (url === undefined) return false;
    url.hash = '';

    if (url.origin === origin) {
      if (url.search !== '') return false;
      const path = decodedPath(url.pathname);
      const key = commentKeyAt(path);
      if (key !== undefined) {
        return options.conversation.comment(key, options.site)?.post.slug === document.slug;
      }
      return path === document.permalink || (document.redirectFrom ?? []).includes(path);
    }

    copies ??= [
      ...handSyndicationOf(document.extra),
      ...Object.values(syndicationCopies(options.records.contentDir).read(document.permalink)),
    ];
    return copies.includes(url.href);
  };
}

/** A URL, when it is an http or https one, and `undefined` otherwise. */
function webUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.hostname === '') return undefined;
  return url;
}

/** The host a source is on, for a page that never says who wrote it. */
function hostOf(source: string): string {
  try {
    return new URL(source).host;
  } catch {
    return source;
  }
}

/** A line of text as the one paragraph of HTML it is. */
function paragraph(text: string): string {
  if (text === '') return '';
  return `<p>${escapeText(text)}</p>`;
}

function refuse(problem: RequestProblem, message: string): WebmentionRequest {
  return { ok: false, problem, message };
}
