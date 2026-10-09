/**
 * Editor actions (decision-33, TASK-285): a running plugin's buttons beside
 * the title, description and tags fields of the post and page editor, and the
 * endpoint each posts the draft to.
 *
 * Core draws the button, the suggestion and its Accept and Dismiss, and
 * `admin/static/editor-actions.js` drives them, so a plugin writes no markup
 * and no browser script: the admin's stylesheet is compiled from core's own
 * templates, and the admin's policy allows scripts from its own origin only.
 * The endpoint is inside the admin guard, so only a signed-in user with the
 * page's CSRF token reaches it, and the draft leaves the server only when the
 * plugin sends it on.
 */

import type { Context, Hono } from 'hono';

import { handleDirectory } from '../content/handles.ts';
import { renderMarkdown } from '../content/markdown.ts';
import { discoverPostType } from '../content/post-type.ts';
import { htmlToText } from '../content/search.ts';
import type { GeekityEnv } from '../env.ts';
import type {
  PluginEditorAction,
  PluginEditorDraft,
  PluginEditorField,
  PluginEditorSuggestion,
  PluginPostType,
} from '../plugin.ts';
import { resolveEvent } from './event-field.ts';
import type { DocumentKind, EditorForm } from './documents.ts';
import { PAGE_KIND, POST_KIND, splitTags, submittedForm } from './documents.ts';
import { PLUGINS_PATH } from './plugins.ts';
import { readSiteSettings } from './settings.ts';

/** The id of the editor's box for each field a plugin's button can sit beside. */
const FIELD_IDS: Readonly<Record<PluginEditorField, string>> = {
  title: 'editor-title',
  description: 'editor-description',
  tags: 'editor-tags',
};

/** How a withdrawn button names the draft it no longer fits. */
const DRAFT_NOUNS: Readonly<Record<PluginPostType, string>> = {
  event: 'an event',
  rsvp: 'an RSVP',
  repost: 'a repost',
  like: 'a like',
  reply: 'a reply',
  photo: 'a photo',
  read: 'a read',
  bookmark: 'a bookmark',
  note: 'a note',
  article: 'an article',
};

/** `/admin/plugins/<package name>/editor/<id>`, a scoped name holding one slash. */
const ENDPOINT = new RegExp(
  `^${PLUGINS_PATH}/((?:@[^/]+/)?[^/@][^/]*)/editor/([a-z0-9]+(?:-[a-z0-9]+)*)$`,
);

/** Where a plugin's editor action is pressed. */
export function editorActionPath(name: string, id: string): string {
  return `${PLUGINS_PATH}/${name}/editor/${id}`;
}

/** One button as the editor draws it. */
export interface EditorActionView {
  url: string;
  label: string;
}

/**
 * The buttons beside each field for this form: every running plugin's action
 * that it offers for the draft as loaded. Empty when none is, so the editor
 * is the editor without plugins.
 */
export function editorActionViews(
  c: Context<GeekityEnv>,
  kind: DocumentKind,
  form: EditorForm,
): Partial<Record<string, EditorActionView[]>> {
  const running = c.var.plugins.plugins.filter(
    (entry) => entry.editorActions.length > 0 && c.var.activePlugins.has(entry.plugin.name),
  );
  if (running.length === 0) return {};

  const draft = editorDraft(c, kind, form);
  const views: Partial<Record<string, EditorActionView[]>> = {};
  for (const { plugin, editorActions } of running) {
    for (const action of editorActions) {
      if (!offered(action, draft)) continue;
      const id = FIELD_IDS[action.field];
      views[id] = [
        ...(views[id] ?? []),
        { url: editorActionPath(plugin.name, action.id), label: action.label },
      ];
    }
  }
  return views;
}

/** The draft a plugin is handed, from the form as the editor holds it. */
function editorDraft(
  c: Context<GeekityEnv>,
  kind: DocumentKind,
  form: EditorForm,
): PluginEditorDraft {
  const { contentDir } = c.var.config;
  const settings = readSiteSettings(contentDir);
  return {
    type: kind.type,
    postType:
      kind.type === 'post' ? postTypeOfForm(form, contentDir, settings.timezone) : undefined,
    saved: form.hash !== '',
    title: form.title,
    body: form.body,
    description: form.description,
    tags: splitTags(form.tags),
    lang: form.lang === '' ? settings.language : form.lang,
  };
}

/** Post Type Discovery over the form, as it would read the saved post. */
function postTypeOfForm(form: EditorForm, contentDir: string, timezone: string): PluginPostType {
  const event = resolveEvent(form.event, timezone);
  return discoverPostType({
    name: form.title,
    content: htmlToText(renderMarkdown(form.body, handleDirectory(contentDir))),
    summary: form.description,
    'in-reply-to': form.inReplyTo,
    start: 'event' in event ? event.event?.start : undefined,
    rsvp: form.rsvp,
    photo: form.photos.map((photo) => photo.url),
    'repost-of': form.repostOf,
    'like-of': form.likeOf,
    'bookmark-of': form.bookmarkOf,
    'read-of': form.readOf.name,
    'read-status': form.readStatus,
  });
}

function offered(action: PluginEditorAction, draft: PluginEditorDraft): boolean {
  try {
    return action.offers?.(draft) ?? true;
  } catch (error) {
    console.warn(`An editor action's offers failed: ${describe(error)}`);
    return false;
  }
}

/**
 * The endpoint. A plugin that is not running, or has no such action, falls
 * through as if the route were absent.
 */
export function mountEditorActions(app: Hono<GeekityEnv>): void {
  app.post(`${PLUGINS_PATH}/*`, async (c, next) => {
    const [, name = '', id = ''] = ENDPOINT.exec(new URL(c.req.url).pathname) ?? [];
    const action = c.var.activePlugins.has(name)
      ? c.var.plugins.find(name)?.editorActions.find((entry) => entry.id === id)
      : undefined;
    if (action === undefined) {
      await next();
      return;
    }

    const body = await c.req.parseBody();
    const kind = body['type'] === 'page' ? PAGE_KIND : POST_KIND;
    const draft = editorDraft(c, kind, submittedForm(kind, body, c.var.config.contentDir));
    if (!offered(action, draft)) {
      const noun = draft.postType === undefined ? 'a page' : DRAFT_NOUNS[draft.postType];
      return c.json({
        ok: false,
        withdrawn: true,
        message: `${action.label} is not offered for ${noun}.`,
      });
    }

    try {
      const suggestion = await action.suggest({
        draft,
        siteTags: c.var.store.listTags().map(({ tag }) => tag),
        recentTitles: recentTitles(c, draft.title),
        signal: c.req.raw.signal,
      });
      if ('choices' in suggestion && action.field === 'description') {
        throw new Error(`it offered choices for the ${action.field}, which holds one value`);
      }
      return c.json(answerOf(suggestion));
    } catch (error) {
      return c.json({ ok: false, message: `${action.label} failed: ${describe(error)}` }, 500);
    }
  });
}

/** The suggestion as JSON, carrying only the fields the editor reads. */
function answerOf(suggestion: PluginEditorSuggestion): object {
  if (!suggestion.ok) return { ok: false, message: suggestion.message };
  if ('value' in suggestion) return { ok: true, value: suggestion.value };
  if ('message' in suggestion) return { ok: true, message: suggestion.message };
  return {
    ok: true,
    choices: suggestion.choices.map(({ value, note, badge, group }) => ({
      value,
      note,
      badge,
      group,
    })),
  };
}

/** How many of the latest titles a plugin is handed. */
const RECENT_TITLES = 10;

function recentTitles(c: Context<GeekityEnv>, own: string): string[] {
  const titles: string[] = [];
  for (const { title } of c.var.store.listPosts({ limit: RECENT_TITLES * 5 })) {
    if (title.trim() === '' || title === own) continue;
    titles.push(title);
    if (titles.length === RECENT_TITLES) break;
  }
  return titles;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
