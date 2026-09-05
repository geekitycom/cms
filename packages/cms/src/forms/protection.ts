import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

import { readFileIfPresentSync, writeFileAtomicallySync } from '../files/atomic.ts';

/**
 * What every form on the public site defends itself with.
 *
 * A comment form (TASK-50) and a contact form (TASK-56) are the same problem
 * wearing different fields: an anonymous stranger posting text at a site that
 * has to store it. So the three cheap defences in front of both live here
 * rather than once each, and neither feature can quietly drift into a weaker
 * version of the other's rules.
 *
 * 1. **The honeypot.** A field no person can see and no person fills in. A
 *    submission that filled it is dropped without a word, because telling a bot
 *    why it failed is telling it how to succeed.
 * 2. **The age of the form.** Something submitted a heartbeat after the page
 *    loaded was not typed, and something submitted from a form rendered last
 *    year is a replayed body. This is a speed bump rather than a control — the
 *    field is not signed, so anything that can read the form can forge it — and
 *    it is here because the naive half of the traffic does not bother.
 * 3. **The address hash.** Not a defence in itself but what makes one
 *    reviewable: a salted hash of where a submission came from, so a run from
 *    one machine is visible without a reader's home address being written down.
 *
 * The fourth, the per-address rate limit, is `createLoginThrottle` in
 * `admin/throttle.ts`, because it is the same limiter the login form uses and
 * it belongs with the rest of that machinery.
 */

/**
 * The honeypot field, named as something a form-filling robot expects to find
 * and a person never sees.
 *
 * The form hides it from sight and from assistive technology and carries
 * `autocomplete="off"` on it, so a browser does not helpfully fill it in.
 */
export const FORM_TRAP_FIELD = 'website';

/** The hidden field carrying when the form was rendered, in epoch milliseconds. */
export const FORM_LOADED_FIELD = 'loaded';

/** How long a form has to have been on screen before it may be submitted. */
export const MINIMUM_SUBMIT_SECONDS = 3;

/**
 * How long a rendered form stays submittable.
 *
 * A day, so a page left open overnight still works, and a `loaded` from last
 * year — which is what a replayed body looks like — does not.
 */
export const MAXIMUM_FORM_AGE_SECONDS = 24 * 60 * 60;

/** Whether the honeypot was filled in, which no person ever does. */
export function trapped(value: string): boolean {
  return value.trim() !== '';
}

/** How long ago the form was rendered, or `undefined` when it did not say. */
export function formAgeSeconds(loaded: string, now: Date): number | undefined {
  const at = Number(loaded);
  if (!Number.isFinite(at) || at <= 0) return undefined;

  const seconds = (now.getTime() - at) / 1000;
  // A form stamped in the future is one somebody wrote by hand, or a clock
  // that moved; either way it is not a form this site rendered a moment ago.
  return seconds < 0 ? undefined : seconds;
}

/** What the clock says about a submission, when it says anything. */
export type FormTimingRefusal =
  /** Rendered too long ago to still be the form it claims to be. */
  | 'stale'
  /** Submitted faster than a person types. */
  | 'too-quick';

/**
 * Whether the form's age refuses this submission, and why.
 *
 * Staleness is decided before speed, because a `loaded` nothing can read is
 * a forged field rather than a fast typist.
 */
export function formTimingRefusal(loaded: string, now: Date): FormTimingRefusal | undefined {
  const age = formAgeSeconds(loaded, now);
  if (age === undefined || age > MAXIMUM_FORM_AGE_SECONDS) return 'stale';
  if (age < MINIMUM_SUBMIT_SECONDS) return 'too-quick';
  return undefined;
}

/**
 * Where the salt that hides submitters' addresses lives, under `dataDir`.
 *
 * Named after comments because comments minted it first and a site that has
 * one must go on using it: a new salt would make every hash already in a
 * comment file incomparable with every hash written after it.
 */
export const ADDRESS_SALT_FILE = 'comment-salt';

/**
 * A submitter's address as the hash a stored record keeps, or `null` when the
 * site could not tell where the request came from.
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
    .update(`${addressSalt(dataDir)}:${address}`)
    .digest('hex')
    .slice(0, 32);
}

/** The site's address salt, minted on first use. */
function addressSalt(dataDir: string): string {
  const file = path.join(dataDir, ADDRESS_SALT_FILE);
  const held = readFileIfPresentSync(file)?.trim();
  if (held !== undefined && held !== '') return held;

  const minted = randomBytes(32).toString('hex');
  writeFileAtomicallySync(file, `${minted}\n`, { mode: 0o600 });
  return minted;
}
