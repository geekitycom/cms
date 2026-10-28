import type {
  ChallengeAttempt,
  ChallengeVerdict,
  ChallengeWidget,
  FormChallenge,
} from '../forms/challenge.ts';
import { HCAPTCHA } from '../settings/hcaptcha.ts';
import type { HcaptchaPairStatus } from '../settings/hcaptcha.ts';
import type { ChangedBy, SettingsRegistry } from '../settings/types.ts';
import { messageOf } from '../util/errors.ts';
import { isRecord } from '../util/guards.ts';

/**
 * hCaptcha: the pair check the settings screen runs, and the
 * {@link FormChallenge} this package ships.
 *
 * The site key and the secret are the `hcaptcha` settings namespace, kept in
 * `data/hcaptcha.json` at mode `0600` or set by `GEEKITY_HCAPTCHA__*`. Both are
 * read on every call, so a pair saved on the settings screen is the one the
 * next call uses, and a pair removed turns the challenge off at once.
 */

/** Where a token is checked, and the only endpoint this speaks to. */
export const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';

/** How long hCaptcha has to answer before the call is abandoned. */
export const HCAPTCHA_TIMEOUT_MS = 10_000;

/**
 * The field hCaptcha's widget puts its answer in.
 *
 * The widget names it itself, so this is the name the server reads rather
 * than one a theme could choose.
 */
export const HCAPTCHA_RESPONSE_FIELD = 'h-captcha-response';

/** The script that draws the widget. */
export const HCAPTCHA_SCRIPT_URL = 'https://js.hcaptcha.com/1/api.js';

/**
 * The token sent when there is no solved challenge to send.
 *
 * hCaptcha refuses it, as it should; what matters is what else it says.
 */
const PLACEHOLDER_TOKEN = 'geekity-pair-check';

/**
 * The error codes that are about the pair rather than the token.
 *
 * hCaptcha reads the token first and stops there for most mistakes, so a
 * secret that is wrong but well formed usually comes back as nothing more
 * than `invalid-input-response`. A malformed site key it does name, and the
 * others are here for the day it names them too.
 */
const PAIR_ERRORS: ReadonlySet<string> = new Set([
  'invalid-sitekey',
  'invalid-input-secret',
  'missing-input-secret',
  'sitekey-secret-mismatch',
]);

/** What {@link verifyHcaptchaPair} needs. */
export interface VerifyHcaptchaPairOptions {
  settings: SettingsRegistry;
  at: Date;
  by: ChangedBy;
  /** The HTTP client. Defaults to the global `fetch`; a test hands in its own. */
  fetch?: typeof fetch | undefined;
  /** How long to wait. */
  timeoutMs?: number | undefined;
}

/**
 * Ask siteverify about the stored site key and secret, and store what it said.
 *
 * `valid` means hCaptcha found nothing wrong with the pair that it can find
 * without a solved challenge; the first real submission is what proves the
 * secret. `invalid` means it named the site key or the secret as the problem,
 * and `unchecked` that it could not be asked. Nothing is asked, and `undefined`
 * comes back, while either value is empty.
 */
export async function verifyHcaptchaPair(
  options: VerifyHcaptchaPairOptions,
): Promise<HcaptchaPairStatus | undefined> {
  const { site_key: siteKey, secret } = await options.settings.values(HCAPTCHA);
  if (siteKey === '' || secret === '') return undefined;

  const status = await askAboutPair(siteKey, secret, options);
  await options.settings.set(
    'hcaptcha',
    new Map<string, unknown>([
      ['status', status],
      ['checked_at', options.at.toISOString()],
    ]),
    options.by,
  );
  return status;
}

async function askAboutPair(
  siteKey: string,
  secret: string,
  options: VerifyHcaptchaPairOptions,
): Promise<HcaptchaPairStatus> {
  const answer = await siteverify(
    { secret, response: PLACEHOLDER_TOKEN, sitekey: siteKey },
    options.fetch,
    options.timeoutMs,
  );
  if (answer.kind === 'unanswered') return 'unchecked';
  return namesThePair(answer.codes) ? 'invalid' : 'valid';
}

/** What {@link createHcaptchaChallenge} needs. */
export interface HcaptchaChallengeOptions {
  settings: SettingsRegistry;
  /** The HTTP client. Defaults to the global `fetch`; a test hands in its own. */
  fetch?: typeof fetch | undefined;
  /** How long hCaptcha has to answer. */
  timeoutMs?: number | undefined;
  /** Where a failure is reported. Defaults to the console. */
  logger?: { warn(message: string): void } | undefined;
}

/**
 * The {@link FormChallenge} that asks hCaptcha.
 *
 * Built whether or not the site has a pair: while the site key or the secret
 * is empty, or the stored pair is one hCaptcha refused, it draws nothing and
 * has no opinion, which is what lets a pair saved on the settings screen start
 * challenging the very next form. A refused pair is off rather than on because
 * a widget drawn with a bad site key never produces a token, and every
 * stranger's submission would be filed as spam.
 *
 * With a pair, a submission with no token fails without a call, and one with a
 * token is checked against siteverify. hCaptcha saying no is a failure; hCaptcha
 * not answering, or saying the problem is the pair rather than the token, is no
 * opinion, and is logged so whoever runs the site can see it.
 *
 * The call is not held in dev mode. It decides what happens to something the
 * site has already been sent, as the Akismet check does, and sends nothing
 * about the site anywhere.
 */
export function createHcaptchaChallenge(options: HcaptchaChallengeOptions): FormChallenge {
  const warn = (message: string): void => {
    (options.logger ?? console).warn(message);
  };

  async function pair(): Promise<{ siteKey: string; secret: string } | undefined> {
    const { site_key: siteKey, secret, status } = await options.settings.values(HCAPTCHA);
    if (siteKey === '' || secret === '' || status === 'invalid') return undefined;
    return { siteKey, secret };
  }

  return {
    field: HCAPTCHA_RESPONSE_FIELD,

    async widget(): Promise<ChallengeWidget | undefined> {
      const held = await pair();
      if (held === undefined) return undefined;
      return {
        provider: 'hcaptcha',
        siteKey: held.siteKey,
        scriptUrl: HCAPTCHA_SCRIPT_URL,
        field: HCAPTCHA_RESPONSE_FIELD,
      };
    },

    async verify(attempt: ChallengeAttempt): Promise<ChallengeVerdict> {
      const held = await pair();
      if (held === undefined) return 'unknown';

      const token = attempt.token.trim();
      if (token === '') return 'fail';

      const answer = await siteverify(
        {
          secret: held.secret,
          response: token,
          sitekey: held.siteKey,
          ...(attempt.address === undefined ? {} : { remoteip: attempt.address }),
        },
        options.fetch,
        options.timeoutMs,
      );

      if (answer.kind === 'unanswered') {
        warn(`hCaptcha could not check a token: ${answer.reason}`);
        return 'unknown';
      }
      if (answer.success) return 'pass';
      if (namesThePair(answer.codes)) {
        warn(`hCaptcha refused the site key or the secret: ${answer.codes.join(', ')}`);
        return 'unknown';
      }
      return 'fail';
    },
  };
}

/** What siteverify said, or that it said nothing usable. */
type SiteverifyAnswer =
  { kind: 'answered'; success: boolean; codes: string[] } | { kind: 'unanswered'; reason: string };

/** One POST to siteverify, and nothing in it that can throw. */
async function siteverify(
  fields: Record<string, string>,
  fetcher: typeof fetch | undefined,
  timeoutMs: number | undefined,
): Promise<SiteverifyAnswer> {
  let answer: unknown;
  try {
    const response = await (fetcher ?? globalThis.fetch)(HCAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(timeoutMs ?? HCAPTCHA_TIMEOUT_MS),
    });
    if (!response.ok) return { kind: 'unanswered', reason: `HTTP ${String(response.status)}` };
    answer = await response.json();
  } catch (error) {
    return { kind: 'unanswered', reason: messageOf(error) };
  }

  if (!isRecord(answer)) return { kind: 'unanswered', reason: 'an answer that is not an object' };
  const codes = answer['error-codes'];
  return {
    kind: 'answered',
    success: answer['success'] === true,
    codes: Array.isArray(codes) ? codes.map(String) : [],
  };
}

function namesThePair(codes: readonly string[]): boolean {
  return codes.some((code) => PAIR_ERRORS.has(code));
}
