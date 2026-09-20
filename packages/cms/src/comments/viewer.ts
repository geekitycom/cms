import type { Context } from 'hono';

import { findUserById } from '../admin/accounts.ts';
import { sessionIdFrom } from '../admin/session.ts';
import type { GeekityEnv } from '../env.ts';
import { authorHref } from '../web/authors.ts';
import type { CommentViewer } from './form.ts';

/**
 * Who the public site knows is reading it, when the request carries a login.
 *
 * The one place outside `/admin` that turns a session cookie into a person.
 * Everything a comment needs about them is answered here — the name it goes
 * under, the archive it links to, the email it is stored with and the token
 * the form has to carry — so the page that draws the form and the endpoint
 * that takes the submission are looking at one reading of one session.
 *
 * Deliberately total about the ways a cookie can be worth nothing. A forged or
 * expired id, a session belonging to a user who has since been deleted, and
 * the anonymous session that holds a CSRF token before anybody has logged in
 * all answer `undefined`, which is the stranger's form: the only thing that
 * gets the short form is a live session naming a user `users.json` still
 * holds, which is the same test the admin guard applies at its own door.
 */
export function signedInCommenter(c: Context<GeekityEnv>): CommentViewer | undefined {
  const id = sessionIdFrom(c);
  if (id === undefined) return undefined;

  // Reading a session prunes an expired one, so this is a live session or
  // nothing at all. Measured against the wall clock rather than the site's
  // configured one, because that is the clock a session was minted against and
  // the one the admin guard reads: a login cannot last longer on the public
  // site than it does in the admin.
  const session = c.var.admin.getSession(id);
  if (session?.userId == null) return undefined;

  const user = findUserById(c.var.config.dataDir, session.userId);
  if (user === undefined) return undefined;

  return {
    // What a byline would print for them, on the same rule: a user who has
    // written no display name is called by their username, which is what
    // their archive is under anyway.
    name: user.profile?.displayName ?? user.username,
    url: authorHref(user.username),
    email: user.email ?? null,
    csrfToken: session.csrfToken,
  };
}
