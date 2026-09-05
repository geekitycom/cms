import type { PostComment } from '../admin/store.ts';
import type { CommentChecker, CommentVerdict } from '../comments/submission.ts';
import type { Document } from '../content/document.ts';
import { formTimingRefusal, hashClientAddress, trapped } from '../forms/protection.ts';
import { contactProblems } from './form.ts';
import type { ContactForm, ContactProblems } from './form.ts';
import { addContactMessage } from './records.ts';
import type { ContactMessage } from './records.ts';

/**
 * What happens between somebody pressing Send and a message existing.
 *
 * The same four defences a comment goes through, in the same order and out of
 * the same modules, because a contact form is the same problem as a comment
 * form wearing different fields:
 *
 * 1. **The honeypot**, first, because it costs one comparison and because a
 *    submission that tripped it should not reach anything that could tell it
 *    so.
 * 2. **The age of the form** — too new to have been typed, or too old to be
 *    the form it claims to be.
 * 3. **The per-address rate limit**, the same limiter the login form and the
 *    comment form use, so one machine cannot send a hundred messages while
 *    nobody is looking.
 * 4. **{@link CommentChecker}**, the one seam a third-party service plugs
 *    into, told this is a `contact-form` rather than a comment.
 *
 * Then the file, and only then the mail. The order is the point: a message is
 * on disk before anything is asked to deliver it, so a provider that is down
 * costs a notification rather than the message.
 */

/** How many messages one address may send before it has to wait. */
export const CONTACT_RATE_LIMIT = 5;

/** How long that window is, and how long the first wait after it lasts. */
export const CONTACT_RATE_WINDOW_SECONDS = 600;

/** The part of the login throttle a contact form needs. */
export interface ContactThrottle {
  /** Seconds before this address may send again, or `undefined`. */
  retryAfter(keys: readonly string[]): number | undefined;
  /** Count one submission against it. */
  fail(keys: readonly string[]): void;
}

/** The keys a submission is rate limited against. */
export function contactKeys(address: string | undefined): string[] {
  return address === undefined ? [] : [`contact:${address}`];
}

/** Why a submission did not become a message. */
export type ContactRefusal =
  /** The form said something a person can put right. */
  | { kind: 'invalid'; problems: ContactProblems }
  /** The form was submitted faster than a person types. */
  | { kind: 'too-quick' }
  /** The form was rendered too long ago to still be one. */
  | { kind: 'stale' }
  /** This address has sent enough for now. `retryAfter` is in seconds. */
  | { kind: 'rate-limited'; retryAfter: number }
  /** The honeypot was filled in, or a checker said to throw it away. */
  | { kind: 'discarded' };

/** What became of a submission. */
export type ContactOutcome =
  { kind: 'stored'; message: ContactMessage } | { kind: 'refused'; refusal: ContactRefusal };

/** What {@link submitContactMessage} needs around it. */
export interface SubmitContactMessageOptions {
  /** Where `data/contact/` is, and where the address salt lives. */
  dataDir: string;
  /** The page the form was on. */
  document: Document;
  /** What was submitted. */
  form: ContactForm;
  /** The site's public origin, for the checker. */
  baseUrl: string;
  /** The checker, when the site has one. */
  checker?: CommentChecker | undefined;
  /** Where the request came from, as far as the site can tell. */
  address?: string | undefined;
  /** The `User-Agent` header, for the checker. */
  userAgent?: string | undefined;
  /** The `Referer` header, for the checker. */
  referrer?: string | undefined;
  /** The rate limiter, kept by the mount so it outlives one request. */
  throttle: ContactThrottle;
  /** The clock. */
  now?: Date | undefined;
}

/**
 * Take a submitted form and, if it survives everything, store the message.
 *
 * The caller has already decided that the page offers a form at all: whether
 * one should exist is `contactOpen`'s question, and asking it here as well
 * would let the two answers differ.
 */
export async function submitContactMessage(
  options: SubmitContactMessageOptions,
): Promise<ContactOutcome> {
  const { form, throttle } = options;
  const now = options.now ?? new Date();

  // The honeypot first, because a submission that tripped it should not reach
  // anything that could tell it why.
  if (trapped(form.trap)) return refused({ kind: 'discarded' });

  const problems = contactProblems(form);
  if (Object.keys(problems).length > 0) return refused({ kind: 'invalid', problems });

  const timing = formTimingRefusal(form.loaded, now);
  if (timing !== undefined) return refused({ kind: timing });

  const keys = contactKeys(options.address);
  const wait = throttle.retryAfter(keys);
  if (wait !== undefined) return refused({ kind: 'rate-limited', retryAfter: wait });

  const proposed = {
    received: now.toISOString(),
    status: 'received' as const,
    page: {
      slug: options.document.slug,
      permalink: options.document.permalink,
      title: options.document.title,
    },
    from: { name: form.name.trim(), email: form.email.trim() },
    subject: form.subject.trim(),
    message: form.message.trim(),
    addressHash: hashClientAddress(options.dataDir, options.address),
  };

  const verdict = await ask(options, proposed, now);
  if (verdict === 'discard') {
    // Counted against the address even so: a machine sending rubbish should
    // not get unlimited free attempts because the rubbish was recognised.
    throttle.fail(keys);
    return refused({ kind: 'discarded' });
  }

  // A message a checker called spam is stored all the same, on a list of its
  // own. A false positive on a contact form is somebody's message vanishing,
  // which is a worse failure than a spam list to glance at.
  const message = await addContactMessage(options.dataDir, {
    ...proposed,
    status: verdict === 'spam' ? 'spam' : 'received',
  });

  throttle.fail(keys);
  return { kind: 'stored', message };
}

/** Ask the checker, if there is one, and treat a broken one as no opinion. */
async function ask(
  options: SubmitContactMessageOptions,
  proposed: Omit<ContactMessage, 'id' | 'read'>,
  now: Date,
): Promise<CommentVerdict> {
  const checker = options.checker;
  if (checker === undefined) return 'unknown';

  try {
    return await checker.check({
      // The seam takes a comment, and a contact message is not one — so it is
      // described as the comment it most nearly is, and `type` says what it
      // actually is. Akismet sends that as `comment_type: contact-form`, which
      // is a value it documents; a site's own checker can read it or ignore it.
      type: 'contact-form',
      comment: asComment(proposed, now),
      post: {
        slug: options.document.slug,
        title: options.document.title,
        url: absolute(options.document.permalink, options.baseUrl),
      },
      address: options.address,
      userAgent: options.userAgent,
      referrer: options.referrer,
      baseUrl: options.baseUrl,
    });
  } catch (error) {
    // A checker that is down must not stop a site taking messages; the message
    // is stored exactly as it would have been before anybody had a checker.
    console.warn(`The comment checker refused to answer about a message: ${messageOf(error)}`);
    return 'unknown';
  }
}

/**
 * A proposed message in the shape the checker seam speaks.
 *
 * The subject is put in front of the message rather than dropped, because it
 * is text a person wrote and a spam service should see it; the address is
 * `null` here because the record keeps a salted hash and the seam is handed
 * the real one separately.
 */
function asComment(
  proposed: Omit<ContactMessage, 'id' | 'read'>,
  now: Date,
): Omit<PostComment, 'id'> {
  const content =
    proposed.subject === '' ? proposed.message : `${proposed.subject}\n\n${proposed.message}`;

  return {
    slug: proposed.page.slug,
    permalink: proposed.page.permalink,
    source: 'comment',
    kind: 'reply',
    status: 'pending',
    author: {
      name: proposed.from.name,
      url: null,
      email: proposed.from.email,
      avatar: null,
    },
    // Plain text, and plain text is its own HTML for a checker's purposes:
    // nothing here is ever rendered onto a page.
    content: { markdown: content, html: content },
    submitted: now.toISOString(),
    addressHash: proposed.addressHash,
    inReplyTo: null,
    url: null,
    notify: false,
  };
}

/** A site-root path as an absolute URL. */
function absolute(pathname: string, baseUrl: string): string {
  try {
    return new URL(pathname, baseUrl).href;
  } catch {
    return pathname;
  }
}

function refused(refusal: ContactRefusal): ContactOutcome {
  return { kind: 'refused', refusal };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
