import type { Context, Hono } from 'hono';

import { AUTOSAVE_FIELD, autosaveCopies, parseAutosaveKey } from '../autosave/index.ts';
import type { AutosaveKey, AutosaveRecord } from '../autosave/index.ts';
import { CSRF_FIELD } from '../forms/protection.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import { stringOrEmpty } from '../util/forms.ts';
import type { GeekityEnv } from '../web/env.ts';
import { creditWriting } from '../writing/ledger.ts';
import { returnPath } from './documents.ts';
import { isDocumentType } from '../content/document.ts';
import { flash, noteClearedAutosave } from './flash.ts';

export const AUTOSAVE_PATH = `${ADMIN_PREFIX}/autosave`;
export const AUTOSAVE_DISCARD_PATH = `${AUTOSAVE_PATH}/discard`;
export const AUTOSAVE_DISCARD_JSON_PATH = `${AUTOSAVE_DISCARD_PATH}.json`;

export interface AutosaveResult {
  key: string;
  savedAt: string;
  wordsToday: number;
}

const BAD_KEY =
  'The autosave key is not a content path or an id this editor was given. Reload the editor.';

export function mountAutosave(app: Hono<GeekityEnv>): void {
  app.post(AUTOSAVE_PATH, async (c) => {
    const body = await c.req.parseBody();
    const key = parseAutosaveKey(c.var.config.contentDir, body[AUTOSAVE_FIELD]);
    if (key === undefined) return c.json({ error: BAD_KEY }, 400);

    const identity = identityOf(c, key, body);
    if (identity === undefined) {
      return c.json({ error: 'There is no document at that path. Reload the editor.' }, 404);
    }

    const { dataDir, now } = c.var.config;
    const userId = signedInUser(c);
    const at = now();
    const fields = submittedFields(body);
    const copies = autosaveCopies(dataDir);
    const before =
      copies.read(userId, key.key)?.fields['body'] ??
      (key.kind === 'existing' ? c.var.store.getByPath(key.path)?.body : undefined) ??
      '';
    const savedAt = at.toISOString();
    const record: AutosaveRecord = {
      ...identity,
      hash: stringOrEmpty(body['hash']),
      fields,
      savedAt,
    };
    copies.save(userId, key.key, record);
    const wordsToday = await creditWriting(dataDir, {
      userId,
      before,
      after: fields['body'] ?? before,
      at,
      timezone: c.var.siteAtRequestStart.timezone,
    });

    const result: AutosaveResult = { key: key.key, savedAt, wordsToday };
    return c.json(result);
  });

  app.post(AUTOSAVE_DISCARD_JSON_PATH, async (c) => {
    const body = await c.req.parseBody();
    const key = parseAutosaveKey(c.var.config.contentDir, body[AUTOSAVE_FIELD]);
    if (key === undefined) return c.json({ error: BAD_KEY }, 400);
    const discarded = autosaveCopies(c.var.config.dataDir).discard(signedInUser(c), key.key);
    return c.json({ discarded });
  });

  app.post(AUTOSAVE_DISCARD_PATH, async (c) => {
    const body = await c.req.parseBody();
    const key = parseAutosaveKey(c.var.config.contentDir, body[AUTOSAVE_FIELD]);
    const back = returnPath(stringOrEmpty(body['return'])) ?? ADMIN_PREFIX;
    if (key === undefined) {
      flash(c, 'error', BAD_KEY);
      return c.redirect(back, 303);
    }
    autosaveCopies(c.var.config.dataDir).discard(signedInUser(c), key.key);
    flash(c, 'notice', 'Discarded the unsaved changes.');
    noteClearedAutosave(c, key.key);
    return c.redirect(back, 303);
  });
}

function signedInUser(c: Context<GeekityEnv>): number {
  const userId = c.var.session?.userId;
  if (userId == null) throw new Error('The admin guard let a request through with no user.');
  return userId;
}

function identityOf(
  c: Context<GeekityEnv>,
  key: AutosaveKey,
  body: Record<string, unknown>,
): Pick<AutosaveRecord, 'type' | 'kind' | 'path'> | undefined {
  const kind = stringOrEmpty(body['kind']);
  if (key.kind === 'new') {
    const type = isDocumentType(body['type']) ? body['type'] : 'post';
    return type === 'post' && kind !== '' ? { type, kind } : { type };
  }
  const document = c.var.store.getByPath(key.path);
  if (document === undefined) return undefined;
  return document.type === 'post' && kind !== ''
    ? { type: document.type, kind, path: document.path }
    : { type: document.type, path: document.path };
}

function submittedFields(body: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(body).filter(
      (entry): entry is [string, string] => entry[0] !== CSRF_FIELD && typeof entry[1] === 'string',
    ),
  );
}
