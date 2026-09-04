import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

import type { PostComment } from '../admin/store.ts';
import type { Document } from '../content/document.ts';
import { readFileIfPresentSync, writeFileAtomicallySync } from '../files/atomic.ts';
import { renderCommentMarkdown } from './markdown.ts';
import { addComment } from './records.ts';
import type { CommentRecords } from './records.ts';

/**
 * What happens between somebody pressing Post and a comment existing.
 *
 * Three defences run before anything is written, in the order that costs least
 * and gives away least:
 *
 * 1. **The honeypot.** A field no person can see and no person fills in. A
 *    submission that filled it is dropped without a word, because telling a bot
 *    why it failed is telling it how to succeed.
 * 2. **The minimum age of the form.** A comment posted a heartbeat after the
 *    page loaded was not typed. This is a speed bump rather than a control —
 *    the field is not signed, so anything that can read the form can forge it —
 *    and it is here because the naive half of the traffic does not bother.
 * 3. **The per-address rate limit.** The same limiter the login form uses, over
 *    the commenter's address, so one machine cannot post a hundred comments
 *    while a moderator sleeps.
 *
 * Then, and only then, {@link CommentChecker} — the one seam a third-party
 * service plugs into. Everything Akismet's API asks for is on the submission
 * it is handed, and its three answers are the three this understands, so
 * TASK-52 is a module that implements this interface and a setting naming a
 * key. Nothing else in the CMS has to know such a service exists.
 */

/** The fields the comment form submits. */
export const COMMENT_FIELDS = {
  /** The post being commented on, as its slug. */
  post: 'post',
  /** The commenter's name. Required. */
  name: 'name',
  /** Their email. Optional, and never shown. */
  email: 'email',
  /** Their website. Optional. */
  url: 'url',
  /** The comment itself, as Markdown. Required. */
  body: 'body',
  /** The comment being answered, or empty for one answering the post. */
  inReplyTo: 'in_reply_to',
  /**
   * The honeypot.
   *
   * Named as something a form-filling robot expects to find and a person never
   * sees: the field is hidden from sight and from assistive technology, and
   * carries `autocomplete="off"` so a browser does not helpfully fill it in.
   */
  trap: 'website',
  /** When the form was rendered, in epoch milliseconds. */
  loaded: 'loaded',
} as const;

/** A submitted comment form, as strings, which is what a form has. */
export type CommentForm = Record<
  'post' | 'name' | 'email' | 'url' | 'body' | 'inReplyTo' | 'trap' | 'loaded',
  string
>;

/** How long a form has to have been on screen before it may be submitted. */
export const MINIMUM_SUBMIT_SECONDS = 3;

/**
 * How long a rendered form stays submittable.
 *
 * A day, so a page left open overnight still works, and a `loaded` from last
 * year — which is what a replayed body looks like — does not.
 */
export const MAXIMUM_FORM_AGE_SECONDS = 24 * 60 * 60;

/** How many comments one address may post before it has to wait. */
export const COMMENT_RATE_LIMIT = 5;

/** How long that window is, and how long the first wait after it lasts. */
export const COMMENT_RATE_WINDOW_SECONDS = 600;

/** The longest a name may be. */
export const MAXIMUM_NAME_LENGTH = 80;

/** The longest an email or a website may be. */
export const MAXIMUM_URL_LENGTH = 500;

/** The longest a comment may be, in characters. */
export const MAXIMUM_BODY_LENGTH = 10_000;

/** What a form got wrong, one message per field. Empty means it is fine. */
export type CommentProblems = Partial<Record<'name' | 'email' | 'url' | 'body', string>>;

/**
 * What is wrong with a submitted comment, as a person would be told it.
 *
 * Only the things a person can fix. The honeypot, the form's age and the rate
 * limit are not here: none of them is the commenter's mistake, and two of them
 * should not be explained to whoever tripped them.
 */
export function commentProblems(form: CommentForm): CommentProblems {
  const problems: CommentProblems = {};

  const name = form.name.trim();
  if (name === '') problems.name = 'A comment needs a name to go under.';
  else if (name.length > MAXIMUM_NAME_LENGTH) {
    problems.name = `That name is longer than ${String(MAXIMUM_NAME_LENGTH)} characters.`;
  }

  const body = form.body.trim();
  if (body === '') problems.body = 'A comment needs something in it.';
  else if (body.length > MAXIMUM_BODY_LENGTH) {
    problems.body = `That comment is longer than ${String(MAXIMUM_BODY_LENGTH)} characters.`;
  }

  const email = form.email.trim();
  if (email !== '' && !isEmail(email)) {
    problems.email =
      'That does not look like an email address. Leave it empty if you would rather.';
  }

  const url = form.url.trim();
  if (url !== '' && normalizeWebsite(url) === undefined) {
    problems.url = 'A website is an http:// or https:// address.';
  }

  return problems;
}

/** Everything a checker is told about a comment on its way in. */
export interface CommentSubmission {
  /** The comment as it would be stored, before anything has judged it. */
  comment: Omit<PostComment, 'id'>;
  /** The post it is on. */
  post: {
    /** Its slug. */
    slug: string;
    /** Its title, for a checker that reports to a human. */
    title: string;
    /** Its absolute URL, which is what Akismet calls the permalink. */
    url: string;
  };
  /**
   * Where the request came from, **unhashed**.
   *
   * A checker needs the address itself, and this is the only place it exists:
   * the stored comment keeps a salted hash, because the file it lives in is
   * published with the site.
   */
  address: string | undefined;
  /** The `User-Agent` the browser sent, as it sent it. */
  userAgent: string | undefined;
  /** The `Referer` the browser sent, which is the page the form was on. */
  referrer: string | undefined;
  /** The site's public origin. */
  baseUrl: string;
}

/** What a stored comment's later reclassification tells the checker. */
export interface CommentReport {
  /** The comment, as it now stands. */
  comment: PostComment;
  /** Its post's absolute URL. */
  url: string;
  /** The site's public origin. */
  baseUrl: string;
}

/**
 * What a checker can say.
 *
 * `spam` files the comment as spam, where a moderator can see it and change
 * its mind. `discard` throws it away without storing it at all, which is what
 * a service says about traffic so obviously mechanical that a queue of it
 * would only be noise. `ham` is a positive opinion and lets the comment
 * through even where the site would have held it. `unknown` is no opinion, and
 * is what a checker that could not be reached should return.
 */
export type CommentVerdict = 'spam' | 'discard' | 'ham' | 'unknown';

/**
 * A third-party opinion on comments: the one seam anything like Akismet plugs
 * into.
 *
 * A site names one as `commentChecker` in its config, and nothing else in the
 * CMS knows the service exists. The two report methods are optional and are
 * called when a moderator disagrees with what happened — marking an approved
 * comment as spam, or letting one out of the spam list — because that
 * correction is the only training signal such a service gets.
 */
export interface CommentChecker {
  /** Judge a comment on its way in. */
  check(submission: CommentSubmission): CommentVerdict | Promise<CommentVerdict>;
  /** Told when a moderator files something as spam. */
  reportSpam?(report: CommentReport): void | Promise<void>;
  /** Told when a moderator says something was not spam after all. */
  reportHam?(report: CommentReport): void | Promise<void>;
}

/** Why a submission did not become a comment. */
export type CommentRefusal =
  /** The form said something a person can put right. */
  | { kind: 'invalid'; problems: CommentProblems }
  /** The form was submitted faster than a person types. */
  | { kind: 'too-quick' }
  /** The form was rendered too long ago to still be one. */
  | { kind: 'stale' }
  /** This address has posted enough for now. `retryAfter` is in seconds. */
  | { kind: 'rate-limited'; retryAfter: number }
  /** The honeypot was filled in, or a checker said to throw it away. */
  | { kind: 'discarded' };

/** What became of a submission. */
export type CommentOutcome =
  { kind: 'stored'; comment: PostComment } | { kind: 'refused'; refusal: CommentRefusal };

/** What {@link submitComment} needs around it. */
export interface SubmitCommentOptions {
  /** The files and the index a stored comment goes into. */
  records: CommentRecords;
  /** The post being commented on. */
  document: Document;
  /** What was submitted. */
  form: CommentForm;
  /** Where the site keeps the address salt. */
  dataDir: string;
  /** The site's public origin, for the checker and the stored links. */
  baseUrl: string;
  /** The checker, when the site named one. */
  checker?: CommentChecker | undefined;
  /** Where the request came from, as far as the site can tell. */
  address?: string | undefined;
  /** The `User-Agent` header, for the checker. */
  userAgent?: string | undefined;
  /** The `Referer` header, for the checker. */
  referrer?: string | undefined;
  /** The rate limiter, kept by the mount so it outlives one request. */
  throttle: CommentThrottle;
  /** The clock. */
  now?: Date | undefined;
}

/** The part of the login throttle a comment needs. */
export interface CommentThrottle {
  /** Seconds before this address may post again, or `undefined`. */
  retryAfter(keys: readonly string[]): number | undefined;
  /** Count one submission against it. */
  fail(keys: readonly string[]): void;
}

/**
 * Take a submitted form and, if it survives everything, store the comment.
 *
 * The caller has already decided that the post is open: whether a form should
 * exist at all is {@link commentsOpen}'s question, and asking it here as well
 * would let the two answers differ.
 */
export async function submitComment(options: SubmitCommentOptions): Promise<CommentOutcome> {
  const { records, document, form, throttle } = options;
  const now = options.now ?? new Date();

  // The honeypot first, because it costs one comparison and because a
  // submission that tripped it should not reach anything that could tell it so.
  if (form.trap.trim() !== '') return refused({ kind: 'discarded' });

  const problems = commentProblems(form);
  if (Object.keys(problems).length > 0) return refused({ kind: 'invalid', problems });

  const age = formAgeSeconds(form.loaded, now);
  if (age === undefined || age > MAXIMUM_FORM_AGE_SECONDS) return refused({ kind: 'stale' });
  if (age < MINIMUM_SUBMIT_SECONDS) return refused({ kind: 'too-quick' });

  const keys = commentKeys(options.address);
  const wait = throttle.retryAfter(keys);
  if (wait !== undefined) return refused({ kind: 'rate-limited', retryAfter: wait });

  const markdown = form.body.trim();
  const author = {
    name: form.name.trim(),
    url: normalizeWebsite(form.url.trim()) ?? null,
    email: form.email.trim() === '' ? null : form.email.trim(),
    // A form asks for no picture: only a webmention brings one (TASK-51).
    avatar: null,
  };
  const proposed: Omit<PostComment, 'id'> = {
    slug: document.slug,
    permalink: document.permalink,
    source: 'comment',
    kind: 'reply',
    // WordPress's rule, and the whole of the auto-approval decision: somebody a
    // moderator has already let through does not queue again.
    status: records.admin.hasApprovedAuthor(author.name, author.email) ? 'approved' : 'pending',
    author,
    content: { markdown, html: renderCommentMarkdown(markdown) },
    submitted: now.toISOString(),
    addressHash: hashClientAddress(options.dataDir, options.address),
    inReplyTo: parentOf(form.inReplyTo, document.slug, records),
    // A comment written here lives here: only a webmention has a page of its
    // own somewhere else (TASK-51).
    url: null,
  };

  const verdict = await ask(options, proposed, now);
  if (verdict === 'discard') {
    // Counted against the address even so: a machine posting rubbish should
    // not get unlimited free attempts because the rubbish was recognised.
    throttle.fail(keys);
    return refused({ kind: 'discarded' });
  }

  const stored = await addComment(records, {
    ...proposed,
    status: verdict === 'spam' ? 'spam' : verdict === 'ham' ? 'approved' : proposed.status,
  });

  throttle.fail(keys);
  return { kind: 'stored', comment: stored };
}

/** Ask the checker, if there is one, and treat a broken one as no opinion. */
async function ask(
  options: SubmitCommentOptions,
  comment: Omit<PostComment, 'id'>,
  _now: Date,
): Promise<CommentVerdict> {
  const checker = options.checker;
  if (checker === undefined) return 'unknown';

  const submission: CommentSubmission = {
    comment,
    post: {
      slug: options.document.slug,
      title: options.document.title,
      url: absolute(options.document.permalink, options.baseUrl),
    },
    address: options.address,
    userAgent: options.userAgent,
    referrer: options.referrer,
    baseUrl: options.baseUrl,
  };

  try {
    return await checker.check(submission);
  } catch (error) {
    // A checker that is down must not stop a site taking comments; the comment
    // falls back to whatever the site's own rules said about it.
    console.warn(`The comment checker refused to answer: ${messageOf(error)}`);
    return 'unknown';
  }
}

/**
 * The comment a submission answers, or `null`.
 *
 * A named parent that is not a comment on this very post is dropped rather
 * than stored: threading a reply under something on another page would put it
 * somewhere nobody can see it, and an id somebody made up is not a parent.
 */
function parentOf(submitted: string, slug: string, records: CommentRecords): string | null {
  const id = submitted.trim();
  if (id === '') return null;

  const parent = records.admin.getComment(id);
  return parent !== undefined && parent.slug === slug ? parent.id : null;
}

/** The keys a submission is rate limited against. */
export function commentKeys(address: string | undefined): string[] {
  return address === undefined ? [] : [`comment:${address}`];
}

/** How long ago the form was rendered, or `undefined` when it did not say. */
function formAgeSeconds(loaded: string, now: Date): number | undefined {
  const at = Number(loaded);
  if (!Number.isFinite(at) || at <= 0) return undefined;

  const seconds = (now.getTime() - at) / 1000;
  // A form stamped in the future is one somebody wrote by hand, or a clock
  // that moved; either way it is not a form this site rendered a moment ago.
  return seconds < 0 ? undefined : seconds;
}

/** Where the salt that hides commenters' addresses lives, under `dataDir`. */
export const COMMENT_SALT_FILE = 'comment-salt';

/**
 * A commenter's address as the hash the file keeps, or `null` when the site
 * could not tell where the request came from.
 *
 * Salted, and the salt is a file under `data/` rather than a constant, because
 * an unsalted hash of an IPv4 address is the address: there are four billion
 * of them and a laptop tries them all in seconds. The comment files are
 * published with the site and go into git, so an address in one would be a
 * reader's home written into a public repository.
 *
 * Losing the salt costs a site the ability to compare old hashes with new
 * ones, and nothing else — which is why it lives beside the keys rather than
 * in the content directory.
 */
export function hashClientAddress(dataDir: string, address: string | undefined): string | null {
  if (address === undefined || address === '') return null;

  return createHash('sha256')
    .update(`${commentSalt(dataDir)}:${address}`)
    .digest('hex')
    .slice(0, 32);
}

/** The site's address salt, minted on first use. */
function commentSalt(dataDir: string): string {
  const file = path.join(dataDir, COMMENT_SALT_FILE);
  const held = readFileIfPresentSync(file)?.trim();
  if (held !== undefined && held !== '') return held;

  const minted = randomBytes(32).toString('hex');
  writeFileAtomicallySync(file, `${minted}\n`, { mode: 0o600 });
  return minted;
}

/**
 * A submitted website as the absolute URL it means, or `undefined` when it
 * means none.
 *
 * A bare `example.com` becomes `https://example.com/`, because that is what
 * somebody typing it meant and refusing it would be pedantry; anything whose
 * scheme is not http or https is refused, because it is going on a page as a
 * link.
 */
export function normalizeWebsite(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > MAXIMUM_URL_LENGTH) return undefined;

  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.hostname === '') return undefined;
  return url.href;
}

/**
 * Whether something looks like an email address.
 *
 * Deliberately loose. The address is never shown and nothing is ever sent to
 * it (TASK-50 has no email at all), so the only thing checking it buys is
 * catching a typo; a stricter rule would refuse valid addresses and buy
 * nothing.
 */
function isEmail(value: string): boolean {
  if (value.length > MAXIMUM_URL_LENGTH) return false;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

/** A site-root path as an absolute URL. */
function absolute(pathname: string, baseUrl: string): string {
  try {
    return new URL(pathname, baseUrl).href;
  } catch {
    return pathname;
  }
}

function refused(refusal: CommentRefusal): CommentOutcome {
  return { kind: 'refused', refusal };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
