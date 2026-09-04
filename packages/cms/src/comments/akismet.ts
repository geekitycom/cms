import { rm } from 'node:fs/promises';
import path from 'node:path';

import { readFileIfPresentSync, writeFileAtomically } from '../files/atomic.ts';
import { COMMENT_FIELDS } from './submission.ts';
import type { CommentChecker, CommentReport, CommentSubmission } from './submission.ts';

/**
 * Akismet, as the one {@link CommentChecker} this package ships.
 *
 * The CMS knows about spam services through a seam and nothing else (doc-6):
 * everything below implements that interface and reaches one HTTP API. Take
 * this file away and comments still work, still queue, and still moderate.
 *
 * Two things make it optional at runtime rather than at build time:
 *
 * - **The key is a credential**, so it lives in `data/akismet.json` at mode
 *   `0600` beside the password hashes and the actor's private keys, and never
 *   in `content/_data/site.json`, which is public, in git and published with
 *   the site.
 * - **The key file is read on every call**, so a key pasted into the settings
 *   screen starts filtering the next comment and a key removed stops filtering
 *   at once. Without one, nothing is sent anywhere and the verdict is
 *   `unknown` — the site's own rules decide, exactly as they did before
 *   anybody had heard of Akismet.
 */

/** Where the key lives, under `dataDir`. */
export const AKISMET_KEY_FILE = 'akismet.json';

/** The API this speaks. */
export const AKISMET_ENDPOINT = 'https://rest.akismet.com/1.1';

/**
 * What Akismet is told this is.
 *
 * Its docs ask for `Application/Version | Plugin/Version`, and the pair is how
 * a report in their dashboard says which piece of software sent a call.
 */
export const AKISMET_USER_AGENT = 'Geekity CMS/1.0 | Akismet/1.1';

/**
 * How long Akismet has to answer before the call is abandoned.
 *
 * A comment must not wait on somebody else's service: an abandoned call is a
 * logged failure and no opinion, and the comment goes to the queue.
 */
export const AKISMET_TIMEOUT_MS = 10_000;

/** What the last {@link verifyAkismetKey} of a key came to. */
export type AkismetKeyStatus =
  /** Akismet said `valid`. */
  | 'valid'
  /** Akismet said `invalid`: the key is not one of theirs, or not any more. */
  | 'invalid'
  /** Akismet could not be reached, so nothing is known either way. */
  | 'unchecked';

/** The key as `data/akismet.json` holds it. */
export interface AkismetKeyRecord {
  /** The key itself. */
  key: string;
  /** What Akismet said about it when it was last checked. */
  status: AkismetKeyStatus;
  /** When that was, as an instant. */
  checkedAt: string;
}

/**
 * The stored key, or `undefined` when the site has none.
 *
 * Read tolerantly and synchronously, like every other file this CMS treats as
 * truth: a file that will not parse, or one with no key in it, is a site with
 * no Akismet rather than a site that will not boot.
 */
export function readAkismetKey(dataDir: string): AkismetKeyRecord | undefined {
  const raw = readFileIfPresentSync(akismetKeyPath(dataDir));
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const file = parsed as Record<string, unknown>;
  const key = typeof file['key'] === 'string' ? file['key'].trim() : '';
  if (key === '') return undefined;

  const status = file['status'];
  return {
    key,
    status: status === 'valid' || status === 'invalid' ? status : 'unchecked',
    checkedAt: typeof file['checkedAt'] === 'string' ? file['checkedAt'] : '',
  };
}

/** Write the key, private to the account the site runs as. */
export async function writeAkismetKey(dataDir: string, record: AkismetKeyRecord): Promise<void> {
  await writeFileAtomically(akismetKeyPath(dataDir), `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
}

/** Forget the key, which is how a site turns Akismet off. */
export async function removeAkismetKey(dataDir: string): Promise<void> {
  await rm(akismetKeyPath(dataDir), { force: true });
}

/** Where one site's key file is. */
export function akismetKeyPath(dataDir: string): string {
  return path.join(dataDir, AKISMET_KEY_FILE);
}

/** What {@link verifyAkismetKey} needs. */
export interface VerifyAkismetKeyOptions {
  /** The key to check. */
  key: string;
  /** The site's public origin, which Akismet calls the blog. */
  blog: string;
  /** The HTTP client. Defaults to the global `fetch`; a test hands in its own. */
  fetch?: typeof fetch | undefined;
  /** How long to wait. */
  timeoutMs?: number | undefined;
}

/**
 * Ask Akismet whether a key is one of theirs.
 *
 * Three answers rather than two, because "we could not ask" is not "no": a key
 * typed while the machine is offline should not be reported as a bad key, and
 * the settings screen says which of the two happened.
 */
export async function verifyAkismetKey(
  options: VerifyAkismetKeyOptions,
): Promise<AkismetKeyStatus> {
  const body = new URLSearchParams({ api_key: options.key, blog: options.blog });

  let answer: AkismetAnswer;
  try {
    answer = await post(`${AKISMET_ENDPOINT}/verify-key`, body, options.fetch, options.timeoutMs);
  } catch {
    return 'unchecked';
  }

  if (!answer.ok) return 'unchecked';
  return answer.body.trim() === 'valid' ? 'valid' : 'invalid';
}

/** What {@link createAkismetChecker} needs around it. */
export interface AkismetCheckerOptions {
  /** Where the key file lives. Read on every call, so a new key needs no restart. */
  dataDir: string;
  /**
   * The site's language, as `blog_lang` wants it.
   *
   * A function rather than a string because the setting is a file the admin
   * rewrites: reading it when a comment arrives is what makes a change to it
   * take effect at once, the way every other setting does (decision-9).
   */
  language: () => string;
  /** The HTTP client. Defaults to the global `fetch`; a test hands in its own. */
  fetch?: typeof fetch | undefined;
  /** Where a failure is reported. Defaults to the console. */
  logger?: { warn(message: string): void } | undefined;
  /** How long Akismet has to answer. */
  timeoutMs?: number | undefined;
  /**
   * Send `is_test`, so nothing said here trains the classifier or counts
   * against the site's plan. Off in production and on wherever a real key
   * could conceivably meet a real endpoint from a test.
   */
  isTest?: boolean | undefined;
}

/**
 * A {@link CommentChecker} that asks Akismet.
 *
 * Built whether or not the site has a key: with none, every method returns
 * without sending anything, which is what lets a key pasted into the settings
 * screen start working on the very next comment.
 *
 * Nothing here throws. The seam would catch it and call it `unknown` anyway
 * (doc-6), but then the log would say only that a checker refused to answer;
 * catching it here is what puts Akismet's own words — a 503, a
 * `X-akismet-debug-help` — in front of whoever has to work out why the queue
 * has stopped being filtered.
 */
export function createAkismetChecker(options: AkismetCheckerOptions): CommentChecker {
  const warn = (message: string): void => {
    (options.logger ?? console).warn(message);
  };

  /** Send one call, or nothing at all when the site has no key. */
  async function send(
    method: 'comment-check' | 'submit-spam' | 'submit-ham',
    fields: (key: string) => URLSearchParams,
  ): Promise<AkismetAnswer | undefined> {
    const stored = readAkismetKey(options.dataDir);
    if (stored === undefined) return undefined;

    try {
      const answer = await post(
        `${AKISMET_ENDPOINT}/${method}`,
        fields(stored.key),
        options.fetch,
        options.timeoutMs,
      );

      if (!answer.ok) {
        warn(`Akismet answered ${method} with ${String(answer.status)}.${help(answer)}`);
        return undefined;
      }

      return answer;
    } catch (error) {
      warn(`Akismet could not be asked about ${method}: ${messageOf(error)}`);
      return undefined;
    }
  }

  return {
    async check(submission) {
      const answer = await send('comment-check', (key) => checkFields(key, submission, options));
      if (answer === undefined) return 'unknown';

      const said = answer.body.trim();
      if (said === 'true') return answer.proTip?.trim() === 'discard' ? 'discard' : 'spam';

      // Anything that is not `true` or `false` is Akismet telling us the call
      // was wrong — a key it does not know, a blog it cannot parse — and the
      // header is where it says which.
      if (said !== 'false') {
        warn(`Akismet answered comment-check with ${JSON.stringify(said)}.${help(answer)}`);
        return 'unknown';
      }

      // `false` is not `ham`. Akismet saw nothing wrong; whether that means
      // approved or pending is TASK-50's rule about who has commented before,
      // and this has no business overruling it.
      return 'unknown';
    },

    async reportSpam(report) {
      await send('submit-spam', (key) => reportFields(key, report, options));
    },

    async reportHam(report) {
      await send('submit-ham', (key) => reportFields(key, report, options));
    },
  };
}

/** The fields one `comment-check` carries. */
function checkFields(
  key: string,
  submission: CommentSubmission,
  options: AkismetCheckerOptions,
): URLSearchParams {
  const { comment } = submission;
  const webmention = comment.source === 'webmention';

  return fields({
    api_key: key,
    blog: submission.baseUrl,
    blog_charset: 'UTF-8',
    blog_lang: blogLang(options.language()),
    user_ip: submission.address,
    user_agent: submission.userAgent,
    referrer: submission.referrer,
    permalink: submission.post.url,
    // A webmention is a page linking here rather than a form somebody filled
    // in, and Akismet takes a type it does not know as a type of its own.
    comment_type: webmention ? 'webmention' : 'comment',
    comment_author: comment.author.name,
    comment_author_email: comment.author.email ?? undefined,
    comment_author_url: comment.author.url ?? undefined,
    comment_content: comment.content.markdown,
    comment_date_gmt: comment.submitted,
    // Naming the honeypot lets Akismet see that a submission left it empty,
    // which is one more thing it knows about a comment it is judging. A
    // webmention went through no form, so there is nothing to name.
    honeypot_field_name: webmention ? undefined : COMMENT_FIELDS.trap,
    is_test: options.isTest === true ? '1' : undefined,
  });
}

/**
 * The fields a `submit-spam` or `submit-ham` carries.
 *
 * As close to the original `comment-check` as this site can get, which is what
 * Akismet asks for — but not all the way there. `user_ip`, `user_agent` and
 * `referrer` are gone, because a stored comment keeps a salted hash of the
 * address and nothing else (doc-6): the file is published with the site, and
 * an address in it would be a reader's home written into a public repository.
 * The content, the author and the permalink are what is left, and they are
 * what a correction is mostly about.
 */
function reportFields(
  key: string,
  report: CommentReport,
  options: AkismetCheckerOptions,
): URLSearchParams {
  const { comment } = report;

  return fields({
    api_key: key,
    blog: report.baseUrl,
    blog_charset: 'UTF-8',
    blog_lang: blogLang(options.language()),
    permalink: report.url,
    comment_type: comment.source === 'webmention' ? 'webmention' : 'comment',
    comment_author: comment.author.name,
    comment_author_email: comment.author.email ?? undefined,
    comment_author_url: comment.author.url ?? undefined,
    comment_content: comment.content.markdown,
    comment_date_gmt: comment.submitted,
    is_test: options.isTest === true ? '1' : undefined,
  });
}

/** A body, with everything the site could not fill in left out entirely. */
function fields(values: Record<string, string | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') body.set(name, value);
  }
  return body;
}

/**
 * A language setting as `blog_lang` wants it: ISO 639-1, so `en-GB` is `en`.
 *
 * The setting is a BCP 47 tag because that is what an `<html lang>` and a feed
 * want; Akismet documents the shorter thing, and the primary subtag is it.
 */
function blogLang(language: string): string {
  return (language.split('-')[0] ?? '').trim().toLowerCase();
}

/** Whatever Akismet said was wrong, as a sentence to append to a log line. */
function help(answer: AkismetAnswer): string {
  return answer.debugHelp === undefined ? '' : ` ${answer.debugHelp}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One answer from Akismet, reduced to what any caller here needs. */
interface AkismetAnswer {
  /** Whether the status was a 2xx. */
  ok: boolean;
  /** The status, for the log. */
  status: number;
  /** The body, trimmed by the caller. */
  body: string;
  /** `X-akismet-pro-tip`, when there was one. */
  proTip: string | undefined;
  /** `X-akismet-debug-help`, which is where Akismet says what was wrong. */
  debugHelp: string | undefined;
}

/** POST a urlencoded body to Akismet and read the answer. */
async function post(
  url: string,
  body: URLSearchParams,
  client: typeof fetch | undefined,
  timeoutMs: number | undefined,
): Promise<AkismetAnswer> {
  const call = client ?? globalThis.fetch;
  const response = await call(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      'user-agent': AKISMET_USER_AGENT,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(timeoutMs ?? AKISMET_TIMEOUT_MS),
  });

  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
    proTip: response.headers.get('x-akismet-pro-tip') ?? undefined,
    debugHelp: response.headers.get('x-akismet-debug-help') ?? undefined,
  };
}
