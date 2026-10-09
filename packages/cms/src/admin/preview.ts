import type { Context, Hono } from 'hono';

import { CITATION_PROPERTIES } from '../content/citation.ts';
import { READ_OF_FRONT_MATTER_KEY, READ_STATUS_FRONT_MATTER_KEY } from '../content/read.ts';
import { RSVP_FRONT_MATTER_KEY, rsvpValue } from '../content/rsvp.ts';
import { eventFrontMatter, resolveEvent, submittedEventForm } from './event-field.ts';
import type { Document, DocumentType } from '../content/document.ts';
import { handleDirectory } from '../content/handles.ts';
import { renderMarkdown } from '../content/markdown.ts';
import { defaultPermalink, slugify } from '../content/slug.ts';
import { calendarDayIn, toUtcInstant } from '../content/time.ts';
import { normalizeBody } from '../content/writer.ts';
import type { GeekityEnv } from '../env.ts';
import { authorContext } from '../web/authors.ts';
import { documentContext } from '../web/context.ts';
import { findUserById, listUsers } from './accounts.ts';
import { READ_FIELDS, resolveRead, submittedReadOfForm } from './read-field.ts';
import { TEMPLATES } from '../web/render.ts';
import { splitTags } from './documents.ts';
import { readSiteSettings } from './settings.ts';
import { ADMIN_PREFIX } from './session.ts';

/** Where the editor posts a body it wants to see rendered. */
export const PREVIEW_PATH = `${ADMIN_PREFIX}/preview`;

/**
 * Render an unsaved body the way the public site would render it.
 *
 * The point of a preview is that it is not a second renderer. This builds the
 * same {@link Document} shape the parser produces, runs the body through the
 * same {@link renderMarkdown}, hands it to the same `documentContext`, and
 * renders it through the theme's own post or page layout — so what the preview
 * shows is what publishing would put on the site, theme overrides included.
 *
 * Nothing is written and nothing is indexed: the document exists for the
 * length of one response.
 */
export function mountPreview(app: Hono<GeekityEnv>): void {
  app.post(PREVIEW_PATH, async (c) => {
    const body = await c.req.parseBody();
    const type: DocumentType = text(body['type']) === 'page' ? 'page' : 'post';
    const document = previewDocument(c, { type, body });

    return c.html(
      c.var.renderer.render(
        type === 'post' ? TEMPLATES.post : TEMPLATES.page,
        // With the site's image config, so a preview shows the `<picture>` the
        // published page would show rather than the plain image behind it, and
        // with the author resolved, so the byline reads the way the published
        // page's would (TASK-67).
        {
          ...documentContext(
            document,
            c.var.config,
            authorContext(listUsers(c.var.config.dataDir), document.author),
            { lead: true },
            (url) => c.var.replyContexts.read(url),
          ),
          editorPreview: true,
        },
      ),
    );
  });
}

/** What a submitted editor form looks like as a document nobody has saved. */
function previewDocument(
  c: Context<GeekityEnv>,
  input: { type: DocumentType; body: Record<string, unknown> },
): Document {
  const { type, body } = input;

  const timezone = readSiteSettings(c.var.config.contentDir).timezone;
  const title = text(body['title']).trim();
  // The editor's field is wall-clock time in the site's zone (decision-11), so
  // the preview reads it the way the save will and shows the date the saved
  // post would show rather than one the server's own zone invented.
  const date =
    type === 'post' ? orNow(text(body['date']).trim(), timezone, c.var.store.now()) : undefined;
  const slug = slugify(text(body['slug']).trim()) || slugify(title) || 'preview';
  const markdown = normalizeBody(text(body['body']));

  return {
    type,
    // A path and a permalink the preview needs to have, because the theme
    // prints them; neither is ever written anywhere.
    path: `${type === 'post' ? 'posts' : 'pages'}/${slug}.md`,
    slug,
    permalink: permalinkFor({
      type,
      slug,
      date: date === undefined ? undefined : (calendarDayIn(date, timezone) ?? date),
      submitted: text(body['permalink']).trim(),
    }),
    title: title === '' ? 'Untitled' : title,
    ...(date === undefined ? {} : { date }),
    tags: splitTags(text(body['tags'])),
    categories: splitTags(text(body['categories'])),
    draft: body['draft'] !== undefined,
    ...(text(body['description']) === '' ? {} : { description: text(body['description']).trim() }),
    ...(currentUsername(c) === undefined ? {} : { author: currentUsername(c) }),
    ...(text(body['in-reply-to']).trim() === ''
      ? {}
      : { inReplyTo: text(body['in-reply-to']).trim() }),
    extra: {
      ...Object.fromEntries(
        CITATION_PROPERTIES.flatMap((property) => {
          const cited = text(body[property]).trim();
          return cited === '' ? [] : [[property, cited]];
        }),
      ),
      ...previewRead(body),
      ...previewRsvp(body),
      ...previewEvent(body, timezone),
    },
    body: markdown,
    html: renderMarkdown(markdown, handleDirectory(c.var.config.contentDir)),
    // A preview is not a version of anything, so it has no hash to be
    // mistaken for one.
    hash: '',
  };
}

function previewEvent(body: Record<string, unknown>, timezone: string): Record<string, unknown> {
  const resolved = resolveEvent(submittedEventForm(body), timezone);
  if (!('event' in resolved)) return {};
  return Object.fromEntries(
    Object.entries(eventFrontMatter(resolved.event)).filter(([, value]) => value !== undefined),
  );
}

function previewRsvp(body: Record<string, unknown>): Record<string, unknown> {
  const rsvp = rsvpValue(body[RSVP_FRONT_MATTER_KEY]);
  return rsvp === undefined ? {} : { [RSVP_FRONT_MATTER_KEY]: rsvp };
}

function previewRead(body: Record<string, unknown>): Record<string, unknown> {
  const resolved = resolveRead(text(body[READ_FIELDS.status]).trim(), submittedReadOfForm(body));
  if (!('read' in resolved) || resolved.read === undefined) return {};
  return {
    [READ_OF_FRONT_MATTER_KEY]: resolved.read.of,
    [READ_STATUS_FRONT_MATTER_KEY]: resolved.read.status,
  };
}

/** The permalink to show: the one the form carried, or the one the slug implies. */
function permalinkFor(input: {
  type: DocumentType;
  slug: string;
  date: string | undefined;
  submitted: string;
}): string {
  if (input.submitted !== '') return input.submitted;
  try {
    return defaultPermalink({ type: input.type, slug: input.slug, date: input.date });
  } catch {
    return '/';
  }
}

/**
 * The date field as a UTC instant. One that is empty or unusable becomes now,
 * so the layout always has one to print.
 */
function orNow(value: string, timezone: string, now: Date): string {
  const instant = /^\d{4}-\d{2}-\d{2}/.test(value) ? toUtcInstant(value, timezone) : undefined;
  return instant ?? now.toISOString();
}

/** The signed-in user's login, so a byline in the theme has something to print. */
function currentUsername(c: Context<GeekityEnv>): string | undefined {
  const userId = c.var.session?.userId;
  if (userId == null) return undefined;
  return findUserById(c.var.config.dataDir, userId)?.username;
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
