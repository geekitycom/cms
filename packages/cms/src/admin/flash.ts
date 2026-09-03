import type { Context } from 'hono';

import type { GeekityEnv } from '../env.ts';
import type { FlashKind, FlashMessage } from './store.ts';

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
