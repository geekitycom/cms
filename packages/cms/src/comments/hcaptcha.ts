import { HCAPTCHA } from '../settings/hcaptcha.ts';
import type { HcaptchaPairStatus } from '../settings/hcaptcha.ts';
import type { ChangedBy, SettingsRegistry } from '../settings/types.ts';
import { isRecord } from '../util/guards.ts';

/**
 * hCaptcha, as far as the settings screen needs it.
 *
 * The site key and the secret are the `hcaptcha` settings namespace, kept in
 * `data/hcaptcha.json` at mode `0600` or set by `GEEKITY_HCAPTCHA__*`. Both are
 * read on every call, so a pair saved on the settings screen is the one the
 * next call uses.
 */

/** Where a token is checked, and the only endpoint this speaks to. */
export const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';

/** How long hCaptcha has to answer before the call is abandoned. */
export const HCAPTCHA_TIMEOUT_MS = 10_000;

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
  const body = new URLSearchParams({ secret, response: PLACEHOLDER_TOKEN, sitekey: siteKey });

  let answer: unknown;
  try {
    const response = await (options.fetch ?? globalThis.fetch)(HCAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: body.toString(),
      signal: AbortSignal.timeout(options.timeoutMs ?? HCAPTCHA_TIMEOUT_MS),
    });
    if (!response.ok) return 'unchecked';
    answer = await response.json();
  } catch {
    return 'unchecked';
  }

  if (!isRecord(answer)) return 'unchecked';
  const codes = answer['error-codes'];
  const named = Array.isArray(codes) && codes.some((code) => PAIR_ERRORS.has(String(code)));
  return named ? 'invalid' : 'valid';
}
