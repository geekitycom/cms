import { EMAIL_PATTERN } from './settings.ts';

/**
 * The rules a username, a password and an email address have to satisfy, in
 * one place.
 *
 * There are two doors into the users table — the first-run setup form and
 * `geekity user add` — and an account the CLI made has to be one the form
 * would have accepted. Keeping the rules here rather than in the route module
 * is what makes that true by construction instead of by memory.
 */

/** The shortest password either door accepts. */
export const MINIMUM_PASSWORD_LENGTH = 8;

/** How long a username may be. */
export const MAXIMUM_USERNAME_LENGTH = 64;

/**
 * What a username may be made of: no spaces, and no punctuation that would
 * later need escaping in a URL, a shell or a template.
 */
export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** What is wrong with a username, or `undefined` when nothing is. */
export function usernameProblem(username: string): string | undefined {
  if (USERNAME_PATTERN.test(username)) return undefined;
  return (
    `A username is 1 to ${String(MAXIMUM_USERNAME_LENGTH)} letters, digits, dots, dashes or ` +
    'underscores.'
  );
}

/** What is wrong with a password, or `undefined` when nothing is. */
export function passwordProblem(password: string): string | undefined {
  if (password.length >= MINIMUM_PASSWORD_LENGTH) return undefined;
  return `A password is at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.`;
}

/**
 * What is wrong with a user's email address, or `undefined` when nothing is.
 *
 * The empty string is acceptable: an email is optional on a user (TASK-54),
 * and clearing the box is how somebody says they do not want one. What is
 * checked is the same shape the settings screen checks its From address
 * against — an `@` with something either side of it and a dot in the domain —
 * because the only way to know an address is real is to send to it, and this
 * catches the typo where the wrong field was pasted into the box.
 */
export function emailProblem(email: string): string | undefined {
  const address = email.trim();
  if (address === '' || EMAIL_PATTERN.test(address)) return undefined;
  return 'An email address looks like ada@example.com, or leave it empty.';
}

/**
 * The first thing wrong with a proposed account, or `undefined` when it is
 * acceptable. The username is reported first, so the message names the first
 * thing to fix rather than the last.
 */
export function credentialProblem(username: string, password: string): string | undefined {
  return usernameProblem(username) ?? passwordProblem(password);
}
