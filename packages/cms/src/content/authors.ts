export interface AuthorUser {
  readonly id: number;
  readonly username: string;
  readonly profile?: { readonly displayName?: string | undefined } | undefined;
}

/**
 * The user a document's `author` names, or `undefined` when it names nobody.
 *
 * Two rules, in this order, and the order is the whole of it. A username is
 * what doc-2 says the key holds, and it is matched exactly, as a login is. A
 * display name is what files written before decision-14 hold — the demo's own
 * posts say `Andrew Shell` — and one that exactly one user answers to reads as
 * that user, so an existing site's posts get their bylines and their archives
 * without anybody rewriting a file. Exactly one: two people called the same
 * thing is not an attribution, and guessing between them would put somebody
 * else's post on somebody's archive.
 *
 * The username rule winning means a file saying `ada` is Ada's post even if
 * somebody else has typed `ada` into their display name, which is the safe way
 * round: a login is unique and a display name is anything at all.
 *
 * The mapping is read rather than written. A file keeps whatever it says until
 * the editor next saves it, and the editor writes a username.
 */
export function userForAuthor<U extends AuthorUser>(
  users: readonly U[],
  author: string | undefined,
): U | undefined {
  const wanted = (author ?? '').trim();
  if (wanted === '') return undefined;

  const byUsername = users.find((user) => user.username === wanted);
  if (byUsername !== undefined) return byUsername;

  const named = users.filter((user) => user.profile?.displayName === wanted);
  return named.length === 1 ? named[0] : undefined;
}

/**
 * Every stored `author` string that reads as this user, for the query behind
 * their archive.
 *
 * The inverse of {@link userForAuthor}, and computed by asking it rather than
 * by restating its rules: a candidate counts only when it resolves back to
 * this user, so a display name another user's username has taken, and one two
 * users share, are both left out without this function having to know why.
 */
export function authorNames(users: readonly AuthorUser[], user: AuthorUser): string[] {
  const names: string[] = [];

  for (const candidate of [user.username, user.profile?.displayName]) {
    if (candidate === undefined || candidate === '' || names.includes(candidate)) continue;
    if (userForAuthor(users, candidate)?.id === user.id) names.push(candidate);
  }

  return names;
}
