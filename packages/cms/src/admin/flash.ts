import type { Context } from 'hono';

import type { GeekityEnv } from '../web/env.ts';
import type { FlashKind, FlashMessage } from '../store/admin-store.ts';

/**
 * Queue a message for the next page this visitor asks for.
 *
 * A handler that changes something answers with a redirect, so the message it
 * wants to show has to outlive the response. It is kept on the session row
 * rather than in a cookie: nothing to sign, nothing to forge, and it goes when
 * the session does.
 *
 * Does nothing when there is no session, which is what a message queued right
 * after a logout is.
 */
export function flash(c: Context<GeekityEnv>, kind: FlashKind, message: string): void {
  const session = c.var.session;
  if (session === undefined) return;
  c.var.admin.pushFlash(session.id, { kind, message });
}

/**
 * Queue a message and send the visitor on to the page that will show it.
 *
 * The usual end of a handler that saved or refused something: a 303 so the
 * browser follows with a GET, and a reload of the page it lands on does not
 * submit the form again.
 */
export function flashAndRedirect(
  c: Context<GeekityEnv>,
  kind: FlashKind,
  message: string,
  location: string,
): Response {
  flash(c, kind, message);
  return c.redirect(location, 303);
}

/**
 * Every message queued for this visitor, removed as it is read.
 *
 * Called once while a page is being rendered, which is what makes a flash
 * survive exactly one redirect: the page that shows it is the page that
 * clears it.
 */
export function takeFlash(c: Context<GeekityEnv>): FlashMessage[] {
  const session = c.var.session;
  if (session === undefined) return [];
  return c.var.admin.takeFlash(session.id);
}

export function noteClearedAutosave(c: Context<GeekityEnv>, key: string): void {
  const session = c.var.session;
  if (session === undefined) return;
  c.var.admin.pushClearedAutosave(session.id, key);
}

export function takeClearedAutosaves(c: Context<GeekityEnv>): string[] {
  const session = c.var.session;
  if (session === undefined) return [];
  return c.var.admin.takeClearedAutosaves(session.id);
}
