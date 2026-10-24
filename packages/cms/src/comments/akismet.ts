import { AKISMET } from '../settings/akismet.ts';
import type { AkismetKeyStatus } from '../settings/akismet.ts';
import type { ChangedBy, SettingsRegistry } from '../settings/types.ts';
import { messageOf } from '../util/errors.ts';
import { COMMENT_FIELDS } from './submission.ts';
import type { CommentChecker, CommentReport, CommentSubmission } from '../forms/checker.ts';

/**
 * Akismet, as the one {@link CommentChecker} this package ships.
 *
 * The CMS knows about spam services through a seam and nothing else:
 * everything below implements that interface and reaches one HTTP API. Take
 * this file away and comments still work, still queue, and still moderate.
 *
 * Two things make it optional at runtime rather than at build time:
 *
 * - **The key is a credential**, so it is the secret `akismet.key` setting,
 *   kept in `data/akismet.json` at mode `0600` or set by
 *   `GEEKITY_AKISMET__KEY`, and never in `content/_data/site.json`, which is
 *   public, in git and published with the site.
 * - **The key is read on every call**, so a key pasted into the settings
 *   screen starts filtering the next comment and a key removed stops filtering
 *   at once. Without one, nothing is sent anywhere and the verdict is
 *   `unknown` — the site's own rules decide, exactly as they did before
 *   anybody had heard of Akismet.
 */

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

/** What {@link verifyAkismetKey} needs. */
export interface VerifyAkismetKeyOptions {
  settings: SettingsRegistry;
  /** The site's public origin, which Akismet calls the blog. */
  blog: string;
  at: Date;
  by: ChangedBy;
  /** The HTTP client. Defaults to the global `fetch`; a test hands in its own. */
  fetch?: typeof fetch | undefined;
  /** How long to wait. */
  timeoutMs?: number | undefined;
}

/**
 * Three answers rather than two, because "we could not ask" is not "no": a key
 * typed while the machine is offline should not be reported as a bad key, and
 * the settings screen says which of the two happened.
 */
export async function verifyAkismetKey(
  options: VerifyAkismetKeyOptions,
): Promise<AkismetKeyStatus | undefined> {
  const key = await options.settings.get(AKISMET.key);
  if (key === '') return undefined;

  const status = await askAboutKey(key, options);
  await options.settings.set(
    'akismet',
    new Map<string, unknown>([
      ['status', status],
      ['checked_at', options.at.toISOString()],
    ]),
    options.by,
  );
  return status;
}

async function askAboutKey(
  key: string,
  options: VerifyAkismetKeyOptions,
): Promise<AkismetKeyStatus> {
  const body = new URLSearchParams({ api_key: key, blog: options.blog });

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
  settings: SettingsRegistry;
  /**
   * The site's language, as `blog_lang` wants it.
   *
   * A function rather than a string because the setting is a file the admin
   * rewrites: reading it when a comment arrives is what makes a change to it
   * take effect at once, the way every other setting does.
   */
  language: () => Promise<string>;
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
 * Nothing here throws. The seam would catch it and call it `unknown` anyway,
 * but then the log would say only that a checker refused to answer;
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
    fields: (key: string, language: string) => URLSearchParams,
  ): Promise<AkismetAnswer | undefined> {
    const key = await options.settings.get(AKISMET.key);
    if (key === '') return undefined;
    const language = await options.language();

    try {
      const answer = await post(
        `${AKISMET_ENDPOINT}/${method}`,
        fields(key, language),
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
      const answer = await send('comment-check', (key, language) =>
        checkFields(key, language, submission, options),
      );
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
      // approved or pending is the moderation rule about who has commented
      // before, and this has no business overruling it.
      return 'unknown';
    },

    async reportSpam(report) {
      await send('submit-spam', (key, language) => reportFields(key, language, report, options));
    },

    async reportHam(report) {
      await send('submit-ham', (key, language) => reportFields(key, language, report, options));
    },
  };
}

/** The fields one `comment-check` carries. */
function checkFields(
  key: string,
  language: string,
  submission: CommentSubmission,
  options: AkismetCheckerOptions,
): URLSearchParams {
  const { comment } = submission;
  // A webmention is a page linking here rather than a form somebody filled in,
  // so it has no honeypot to name; a contact message is a form like a
  // comment's, so it does.
  const formless = (submission.type ?? comment.source) === 'webmention';

  return fields({
    api_key: key,
    blog: submission.baseUrl,
    blog_charset: 'UTF-8',
    blog_lang: blogLang(language),
    user_ip: submission.address,
    user_agent: submission.userAgent,
    referrer: submission.referrer,
    permalink: submission.post.url,
    // What the caller says this is, or what the comment says it is: a
    // webmention is a page linking here rather than a form somebody filled in,
    // and Akismet takes a type it does not know as a type of its own.
    comment_type: submission.type ?? (comment.source === 'webmention' ? 'webmention' : 'comment'),
    comment_author: comment.author.name,
    comment_author_email: comment.author.email ?? undefined,
    comment_author_url: comment.author.url ?? undefined,
    comment_content: comment.content.markdown,
    comment_date_gmt: comment.submitted,
    // Naming the honeypot lets Akismet see that a submission left it empty,
    // which is one more thing it knows about a submission it is judging.
    honeypot_field_name: formless ? undefined : COMMENT_FIELDS.trap,
    is_test: options.isTest === true ? '1' : undefined,
  });
}

/**
 * The fields a `submit-spam` or `submit-ham` carries.
 *
 * As close to the original `comment-check` as this site can get, which is what
 * Akismet asks for — but not all the way there. `user_ip`, `user_agent` and
 * `referrer` are gone, because a stored comment keeps a salted hash of the
 * address and nothing else: the file is published with the site, and
 * an address in it would be a reader's home written into a public repository.
 * The content, the author and the permalink are what is left, and they are
 * what a correction is mostly about.
 */
function reportFields(
  key: string,
  language: string,
  report: CommentReport,
  options: AkismetCheckerOptions,
): URLSearchParams {
  const { comment } = report;

  return fields({
    api_key: key,
    blog: report.baseUrl,
    blog_charset: 'UTF-8',
    blog_lang: blogLang(language),
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
