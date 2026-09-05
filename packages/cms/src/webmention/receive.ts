import type { AdminStore, CommentStatus, PostComment } from '../admin/store.ts';
import { addComment, deleteComment, updateComment } from '../comments/records.ts';
import type { CommentRecords } from '../comments/records.ts';
import { hashClientAddress } from '../comments/submission.ts';
import type { CommentChecker, CommentSubmission, CommentVerdict } from '../comments/submission.ts';
import type { Document } from '../content/document.ts';
import { sanitizeCommentHtml } from '../web/sanitize.ts';
import { readCapped, WEBMENTION_USER_AGENT } from './discovery.ts';
import { linksTo, sourceEntry } from './microformats.ts';

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
 * What lands is a comment like any other (doc-6): the same file, the same
 * thread, the same queue, and the same {@link CommentChecker} seam, which is
 * how TASK-52 sends it to Akismet as a `webmention` without this module
 * knowing Akismet exists. What it is not held by is the closing rules: a post
 * that stopped taking comments a year ago still hears about a page that links
 * to it, exactly as it still hears a fediverse reply, because neither is
 * something this site can stop happening.
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
  const held = storedFrom(records.admin, incoming.document.slug, incoming.source);

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

  const proposed: Omit<PostComment, 'id'> = {
    slug: incoming.document.slug,
    permalink: incoming.document.permalink,
    source: 'webmention',
    kind,
    // Held like a native comment: a page linking here is as much a stranger's
    // words as a form submission, and the queue is where a person decides.
    status: 'pending',
    author,
    content: { markdown: text, html },
    submitted: entry?.published ?? now.toISOString(),
    addressHash: hashClientAddress(options.dataDir, incoming.address),
    inReplyTo: null,
    // The URL it was sent from rather than the entry's own `u-url`: this is
    // the identity a later webmention is matched against, and the sender is
    // the one who chose it.
    url: incoming.source,
    // A page has nobody to ask, and no address to ask them at.
    notify: false,
  };

  const verdict = await ask(options, proposed);
  if (verdict === 'discard') {
    if (held === undefined) return { kind: 'ignored' };
    await deleteComment(records, held.id);
    return { kind: 'deleted' };
  }

  if (held !== undefined) {
    // A moderator's decision stands: a source re-sending its webmention must
    // not take an approved mention back into the queue, and must not quietly
    // let a spam one out. A checker that has changed its mind to `spam` is the
    // one thing that moves it, because that is a new fact about the content.
    const status: CommentStatus = verdict === 'spam' ? 'spam' : held.status;
    const moved = await updateComment(records, held.id, {
      kind: proposed.kind,
      status,
      author: proposed.author,
      content: proposed.content,
      submitted: proposed.submitted,
    });
    return moved === undefined
      ? { kind: 'ignored' }
      : { kind: 'stored', comment: moved, created: false };
  }

  const stored = await addComment(records, {
    ...proposed,
    status: verdict === 'spam' ? 'spam' : verdict === 'ham' ? 'approved' : proposed.status,
  });
  return { kind: 'stored', comment: stored, created: true };
}

/** The webmention this site already holds from that source, if any. */
function storedFrom(admin: AdminStore, slug: string, source: string): PostComment | undefined {
  return admin
    .listCommentsFor(slug)
    .find((comment) => comment.source === 'webmention' && comment.url === source);
}

/** Ask the checker, if there is one, and treat a broken one as no opinion. */
async function ask(
  options: VerifyWebmentionOptions,
  comment: Omit<PostComment, 'id'>,
): Promise<CommentVerdict> {
  const checker = options.checker;
  if (checker === undefined) return 'unknown';

  const submission: CommentSubmission = {
    comment,
    post: {
      slug: options.incoming.document.slug,
      title: options.incoming.document.title,
      url: options.incoming.target,
    },
    address: options.incoming.address,
    userAgent: options.incoming.userAgent,
    referrer: options.incoming.referrer,
    baseUrl: options.baseUrl,
  };

  try {
    return await checker.check(submission);
  } catch (error) {
    options.logger.warn(`The comment checker refused to answer: ${messageOf(error)}`);
    return 'unknown';
  }
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

/** Whether a hostname is one only this network can see. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;

  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [a = 0, b = 0] = parts.map(Number);
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
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
