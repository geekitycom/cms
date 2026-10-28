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

export const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';

export const HCAPTCHA_TIMEOUT_MS = 10_000;

/** hCaptcha's widget names this field itself; a theme cannot choose it. */
export const HCAPTCHA_RESPONSE_FIELD = 'h-captcha-response';

export const HCAPTCHA_SCRIPT_URL = 'https://js.hcaptcha.com/1/api.js';

/** hCaptcha refuses this token; the pair check reads the other codes it sends back. */
const PLACEHOLDER_TOKEN = 'geekity-pair-check';

/**
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

export interface VerifyHcaptchaPairOptions {
  settings: SettingsRegistry;
  at: Date;
  by: ChangedBy;
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

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

export interface HcaptchaChallengeOptions {
  settings: SettingsRegistry;
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
  logger?: { warn(message: string): void } | undefined;
}

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

type SiteverifyAnswer =
  { kind: 'answered'; success: boolean; codes: string[] } | { kind: 'unanswered'; reason: string };

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
