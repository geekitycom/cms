import type { PostComment } from '../admin/store.ts';
import { deleteComment, heldWebmention, intakeComment } from '../comments/records.ts';
import type { CommentNotices, CommentRecords, ProposedComment } from '../comments/records.ts';
import type { CommentChecker } from '../comments/submission.ts';
import type { Document } from '../content/document.ts';
import { sanitizeCommentHtml } from '../web/sanitize.ts';
import { readCapped, WEBMENTION_USER_AGENT } from './discovery.ts';
import { linksTo, sourceEntry } from './microformats.ts';
import { isPrivateHost } from './public-address.ts';

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
 * What lands is a comment like any other (doc-6), and it lands the same way:
 * this module reads what the source says and hands `intakeComment` a proposed
 * comment, so the file, the index, the {@link CommentChecker} seam, the
 * verdict-to-status rule and the notice are the very ones a form submission
 * gets. That is how TASK-52 sends it to Akismet as a `webmention` without this
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
  | { readonly ok: false; readonly message: string };

/** What {@link checkWebmentionRequest} needs to answer. */
export interface CheckWebmentionOptions {
  /** The site's public origin. */
  readonly baseUrl: string;
  /** The public document one of this site's paths names, or `undefined`. */
  readonly documentAt: (pathname: string) => Document | undefined;
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
  if (source.trim() === '' || target.trim() === '') {
    return refuse('A webmention needs both a source and a target.');
  }

  const from = webUrl(source);
  const to = webUrl(target);
  if (from === undefined) return refuse('The source is not an http or https URL.');
  if (to === undefined) return refuse('The target is not an http or https URL.');
  if (from.href === to.href) return refuse('The source and the target are the same page.');

  // A source on a loopback or private address is not somebody else's page: it
  // is this network, and fetching it would make the site a way of reaching
  // machines nobody outside can reach. This stops the obvious spelling of that
  // and not a name that resolves to one — a receiver that has to be sure needs
  // to check the address it actually connects to.
  if (isPrivateHost(from.hostname)) return refuse('The source is not a public URL.');

  const site = webUrl(options.baseUrl);
  if (site === undefined || to.origin !== site.origin) {
    return refuse('The target is not a page on this site.');
  }

  const document = options.documentAt(to.pathname);
  if (document === undefined) return refuse('There is no page here at that address.');

  return { ok: true, source: from.href, target: to.href, document };
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
  /** The checker, when the site named one. */
  readonly checker?: CommentChecker | undefined;
  /** Who to tell when one lands in the queue, handed to the intake (TASK-55). */
  readonly notices?: CommentNotices | undefined;
  /** The clock. */
  readonly now: Date;
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
   * time (TASK-55), for an entry that has been in the queue all along.
   */
  | { readonly kind: 'stored'; readonly comment: PostComment; readonly created: boolean }
  /** The source does not link here any more, and what it left is gone. */
  | { readonly kind: 'deleted' }
  /** The source does not link here, and there was nothing to remove. */
  | { readonly kind: 'ignored' }
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

  const fetched = await readSource(incoming.source);
  if (fetched.kind === 'unreachable') {
    options.logger.warn(
      `Could not read ${incoming.source} to verify a webmention: ${fetched.reason}`,
    );
    return { kind: 'unreachable', reason: fetched.reason };
  }

  if (fetched.kind === 'gone' || !mentions(fetched, incoming)) {
    if (held === undefined) return { kind: 'ignored' };
    await deleteComment(records, held.id);
    return { kind: 'deleted' };
  }

  const entry = fetched.html
    ? sourceEntry(fetched.body, fetched.url, incoming.target)
    : // A source that is not HTML — plain text, JSON, anything — has no
      // microformats to read, so all that can be said about it is that it
      // links here.
      undefined;

  const kind = entry?.kind ?? 'mention';
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
    submitted: entry?.published ?? now.toISOString(),
    inReplyTo: null,
    // The URL it was sent from rather than the entry's own `u-url`: this is
    // the identity a later webmention is matched against, and the sender is
    // the one who chose it.
    url: incoming.source,
    // A page has nobody to ask, and no address to ask them at.
    notify: false,
  };

  const outcome = await intakeComment({
    records,
    origin: 'webmention',
    comment: proposed,
    // The target as its sender named it, rather than this site's own idea of
    // the permalink: that is the URL the conversation is about.
    post: { title: incoming.document.title, url: incoming.target },
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
    return { kind: 'stored', comment: outcome.comment, created: outcome.created };
  }
  // A source nobody was holding anything from leaves nothing behind, and one
  // whose entry went while this was deciding has already been dealt with.
  return outcome.kind === 'discarded' && outcome.removed
    ? { kind: 'deleted' }
    : { kind: 'ignored' };
}

/** What reading a source page came to. */
type FetchedSource =
  | { kind: 'read'; body: string; url: string; html: boolean }
  /** Definitely not there: a 404, a 410, anything a retry will not fix. */
  | { kind: 'gone' }
  /** Not readable this time, which is not the same thing at all. */
  | { kind: 'unreachable'; reason: string };

/** Fetch a source page, following redirects and reading no more than a page. */
async function readSource(source: string): Promise<FetchedSource> {
  let response: Response;
  try {
    response = await fetch(source, {
      headers: { accept: 'text/html, */*;q=0.8', 'user-agent': WEBMENTION_USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch (thrown) {
    return { kind: 'unreachable', reason: messageOf(thrown) };
  }

  if (!response.ok) {
    await response.body?.cancel();
    // A page the server says is not there is a page that is not linking here.
    // A server that is broken is a different thing and takes nothing with it.
    if (response.status >= 400 && response.status < 500) return { kind: 'gone' };
    return { kind: 'unreachable', reason: `answered ${String(response.status)}` };
  }

  const type = response.headers.get('content-type') ?? '';
  return {
    kind: 'read',
    body: await readCapped(response),
    url: response.url === '' ? source : response.url,
    html: /^\s*(text\/html|application\/xhtml\+xml)/i.test(type),
  };
}

/**
 * Whether what was read really links to the target.
 *
 * HTML is parsed, because a link is a link and the target written out in the
 * prose is not one. Anything else — plain text, JSON, whatever somebody chose
 * to publish — is searched for the target as it stands, which is all a format
 * with no links can offer and what the spec asks for.
 */
function mentions(
  fetched: { body: string; url: string; html: boolean },
  incoming: IncomingWebmention,
): boolean {
  return fetched.html
    ? linksTo(fetched.body, fetched.url, incoming.target)
    : fetched.body.includes(incoming.target);
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
  return `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`;
}

function refuse(message: string): WebmentionRequest {
  return { ok: false, message };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
