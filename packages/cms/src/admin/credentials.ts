/**
 * The rules a username and a password have to satisfy, in one place.
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
 * The first thing wrong with a proposed account, or `undefined` when it is
 * acceptable. The username is reported first, so the message names the first
 * thing to fix rather than the last.
 */
export function credentialProblem(username: string, password: string): string | undefined {
  return usernameProblem(username) ?? passwordProblem(password);
}
