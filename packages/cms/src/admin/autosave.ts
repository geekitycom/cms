import type { Context, Hono } from 'hono';

import { AUTOSAVE_FIELD, autosaveCopies, parseAutosaveKey } from '../autosave/index.ts';
import type { AutosaveKey, AutosaveRecord } from '../autosave/index.ts';
import { CSRF_FIELD } from '../forms/protection.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import { stringOrEmpty } from '../util/forms.ts';
import type { GeekityEnv } from '../web/env.ts';
import { returnPath } from './documents.ts';
import { flash } from './flash.ts';

/** Where the editor posts its whole form while the writer types. */
export const AUTOSAVE_PATH = `${ADMIN_PREFIX}/autosave`;
export const AUTOSAVE_DISCARD_PATH = `${AUTOSAVE_PATH}/discard`;

/** What a stored autosave answers with. */
export interface AutosaveResult {
  key: string;
  savedAt: string;
}

const BAD_KEY =
  'The autosave key is not a content path or an id this editor was given. Reload the editor.';

/**
 * Register the autosave endpoints (decision-62). A copy is written under
 * `data/autosave/` for the signed-in user only; the document, and every other
 * store, is left alone until the writer saves.
 */
export function mountAutosave(app: Hono<GeekityEnv>): void {
  app.post(AUTOSAVE_PATH, async (c) => {
    const body = await c.req.parseBody();
    const key = parseAutosaveKey(c.var.config.contentDir, body[AUTOSAVE_FIELD]);
    if (key === undefined) return c.json({ error: BAD_KEY }, 400);

    const identity = identityOf(c, key, body);
    if (identity === undefined) {
      return c.json({ error: 'There is no document at that path. Reload the editor.' }, 404);
    }

    const savedAt = c.var.config.now().toISOString();
    const record: AutosaveRecord = {
      ...identity,
      hash: stringOrEmpty(body['hash']),
      fields: submittedFields(body),
      savedAt,
    };
    autosaveCopies(c.var.config.dataDir).save(signedInUser(c), key.key, record);

    const result: AutosaveResult = { key: key.key, savedAt };
    return c.json(result);
  });

  app.post(AUTOSAVE_DISCARD_PATH, async (c) => {
    const body = await c.req.parseBody();
    const key = parseAutosaveKey(c.var.config.contentDir, body[AUTOSAVE_FIELD]);
    const back = returnPath(stringOrEmpty(body['return']));
    if (key === undefined) {
      if (back === undefined) return c.json({ error: BAD_KEY }, 400);
      flash(c, 'error', BAD_KEY);
      return c.redirect(back, 303);
    }

    const discarded = autosaveCopies(c.var.config.dataDir).discard(signedInUser(c), key.key);
    if (back === undefined) return c.json({ discarded });
    flash(c, 'notice', 'Discarded the unsaved changes.');
    return c.redirect(back, 303);
  });
}

/** The user the admin guard let through. */
function signedInUser(c: Context<GeekityEnv>): number {
  const userId = c.var.session?.userId;
  if (userId == null) throw new Error('The admin guard let a request through with no user.');
  return userId;
}

/**
 * The document a copy is of. An existing document is named by the store, so
 * a form cannot file a copy of a page as a post; a new one by what its form says.
 */
function identityOf(
  c: Context<GeekityEnv>,
  key: AutosaveKey,
  body: Record<string, unknown>,
): Pick<AutosaveRecord, 'type' | 'kind' | 'path'> | undefined {
  const kind = stringOrEmpty(body['kind']);
  if (key.kind === 'new') {
    const type = stringOrEmpty(body['type']) === 'page' ? 'page' : 'post';
    return type === 'post' && kind !== '' ? { type, kind } : { type };
  }
  const document = c.var.store.getByPath(key.path);
  if (document === undefined) return undefined;
  return document.type === 'post' && kind !== ''
    ? { type: document.type, kind, path: document.path }
    : { type: document.type, path: document.path };
}

/** Every text field the form posted, as the editor's save handler would read them. */
function submittedFields(body: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(body).filter(
      (entry): entry is [string, string] => entry[0] !== CSRF_FIELD && typeof entry[1] === 'string',
    ),
  );
}
