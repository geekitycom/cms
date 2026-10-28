import { messageOf } from '../util/errors.ts';
import { stringOrEmpty } from '../util/forms.ts';
import type { SubmissionType } from './checker.ts';

/**
 * A challenge a stranger answers in the browser before a public form is sent:
 * the one seam anything like hCaptcha plugs into.
 *
 * A site names one as `formChallenge` in its config; with none named, the
 * package builds its hCaptcha challenge, which does nothing until a site key
 * and a secret are stored. The contact form and a stranger's comment form ask
 * it about every submission that gets past the honeypot, the form's age and
 * the rate limit, before the `CommentChecker` is asked.
 *
 * It never refuses anything. A form has to keep working with JavaScript off,
 * so a submission that brings no answer, or a wrong one, is stored as spam
 * rather than turned away, and a challenge that cannot be reached has no
 * opinion at all.
 */
export interface FormChallenge {
  /**
   * The form field the widget puts its answer in, which is the field the
   * server reads the token from.
   */
  readonly field: string;
  /**
   * What a theme needs to draw the widget, or `undefined` while the challenge
   * is off.
   *
   * Asked per render rather than once, because whether it is on is a setting
   * the admin can change while the site runs.
   */
  widget(): Promise<ChallengeWidget | undefined>;
  /** What the challenge says about one submission's answer. */
  verify(attempt: ChallengeAttempt): Promise<ChallengeVerdict>;
}

/** What a theme draws a challenge from. */
export interface ChallengeWidget {
  /** Which service it is, for a theme that draws more than one. */
  readonly provider: string;
  /** The public key the widget is drawn with. Printed in the page. */
  readonly siteKey: string;
  /** The script that draws it. */
  readonly scriptUrl: string;
  /** The form field its answer is posted in. */
  readonly field: string;
}

/** One submission's answer, and what is known about who sent it. */
export interface ChallengeAttempt {
  /** What the widget put in its field: empty when nothing did. */
  token: string;
  /** Where the request came from, **unhashed**, for a service that wants it. */
  address: string | undefined;
  /** Which form it came from. */
  type: Exclude<SubmissionType, 'webmention'>;
}

/**
 * What a challenge can say.
 *
 * `pass` lets the submission on to the checker as if nothing had asked.
 * `fail` — no answer, or one the service rejected — files it as spam, so it
 * is stored where somebody can look and nobody is told about it. `unknown` is
 * no opinion: the challenge is off, or its service could not be asked, and the
 * submission goes on exactly as it would without one.
 */
export type ChallengeVerdict = 'pass' | 'fail' | 'unknown';

/**
 * Ask a challenge about one submission, when the site has one.
 *
 * A challenge that throws is no opinion, as a checker that throws is: a
 * service having a bad afternoon must never stop a site taking messages.
 */
export async function askChallenge(
  challenge: FormChallenge | undefined,
  attempt: ChallengeAttempt,
  logger: { warn(message: string): void } = console,
): Promise<ChallengeVerdict> {
  if (challenge === undefined) return 'unknown';

  try {
    return await challenge.verify(attempt);
  } catch (error) {
    logger.warn(`The form challenge refused to answer: ${messageOf(error)}`);
    return 'unknown';
  }
}

/** What a challenge's widget posted in a submitted body, or empty for none. */
export function challengeTokenOf(
  body: Record<string, unknown>,
  challenge: FormChallenge | undefined,
): string {
  return challenge === undefined ? '' : stringOrEmpty(body[challenge.field]);
}
