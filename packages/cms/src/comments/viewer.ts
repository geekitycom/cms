import type { User } from '../site/users.ts';
import { authorHref } from '../content/authors.ts';
import type { CommentViewer } from './form.ts';

/** A live login on the public site: who it names, and the session's CSRF token. */
export interface SignedInAccount {
  user: User;
  csrfToken: string;
}

/** What the comment form needs to know about a signed-in account. */
export function commenterOf({ user, csrfToken }: SignedInAccount): CommentViewer {
  return {
    // What a byline would print for them, on the same rule: a user who has
    // written no display name is called by their username, which is what
    // their archive is under anyway.
    username: user.username,
    name: user.profile?.displayName ?? user.username,
    url: authorHref(user.username),
    email: user.email ?? null,
    csrfToken,
  };
}
