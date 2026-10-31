import type { Context, Hono } from 'hono';

import { DOCUMENT_DIRECTORIES } from '../content/content-tree.ts';
import { isDocumentType } from '../content/document.ts';
import type { Document, DocumentType } from '../content/document.ts';
import { DOCUMENT_KINDS } from '../content/document-kind.ts';
import { extraFromForm, formInReplyTo, splitTags } from '../content/document-form.ts';
import { handleDirectory } from '../content/handles.ts';
import { renderMarkdown } from '../content/markdown.ts';
import { defaultPermalink, slugify } from '../content/slug.ts';
import { calendarDayIn, toUtcInstant } from '../content/time.ts';
import { currentUsername } from '../web/document-site.ts';
import type { GeekityEnv } from '../web/env.ts';
import { listUsers } from '../site/users.ts';
import { authorContext } from '../site/authors.ts';
import { documentContext } from '../web/context.ts';
import { DOCUMENT_TEMPLATES } from '../web/theme-templates.ts';
import { PREVIEW_PATH } from '../site/admin-paths.ts';
import { permalinkBasesFromSettings } from '../site/settings.ts';
import { syndicationTargetsReader } from '../webmention/syndication.ts';
import { lenientMedia, submittedForm } from './documents.ts';

/**
 * Render an unsaved body the way the public site would render it.
 *
 * The point of a preview is that it is not a second renderer. This builds the
 * same {@link Document} shape the parser produces, runs the body through the
 * same {@link renderMarkdown}, hands it to the same `documentContext`, and
 * renders it through the theme's own layout for its type — so what the preview
 * shows is what publishing would put on the site, theme overrides included.
 *
 * Nothing is written and nothing is indexed: the document exists for the
 * length of one response.
 */
export function mountPreview(app: Hono<GeekityEnv>): void {
  app.post(PREVIEW_PATH, async (c) => {
    const body = await c.req.parseBody();
    const type: DocumentType = isDocumentType(body['type']) ? body['type'] : 'post';
    const document = previewDocument(c, { type, body });

    return c.html(
      c.var.renderer.render(
        DOCUMENT_TEMPLATES[type],
        // With the site's image config, so a preview shows the `<picture>` the
        // published page would show rather than the plain image behind it, and
        // with the author resolved, so the byline reads the way the published
        // page's would.
        {
          ...documentContext(
            document,
            c.var.config,
            authorContext(listUsers(c.var.config.dataDir), document.author),
            { lead: true },
            (url) => c.var.replyContexts.read(url, c.var.siteAtRequestStart),
          ),
          editorPreview: true,
          cspNonce: c.var.cspNonce,
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
  const kind = DOCUMENT_KINDS[type];
  const contentDir = c.var.config.contentDir;
  const form = submittedForm(kind, body, contentDir);

  const timezone = c.var.siteAtRequestStart.timezone;
  // The editor's field is wall-clock time in the site's zone, so
  // the preview reads it the way the save will and shows the date the saved
  // post would show rather than one the server's own zone invented.
  const date = type === 'post' ? orNow(form.date, timezone, c.var.store.now()) : undefined;
  const slug = slugify(form.slug) || slugify(form.title) || 'preview';
  const inReplyTo = formInReplyTo(kind, form, undefined);

  return {
    type,
    // A path and a permalink the preview needs to have, because the theme
    // prints them; neither is ever written anywhere.
    path: `${DOCUMENT_DIRECTORIES[type]}/${slug}.md`,
    slug,
    permalink: permalinkFor({
      type,
      slug,
      date: date === undefined ? undefined : (calendarDayIn(date, timezone) ?? date),
      submitted: form.permalink,
      wikiBase: permalinkBasesFromSettings(c.var.siteAtRequestStart).wiki,
    }),
    title: form.title === '' ? 'Untitled' : form.title,
    ...(date === undefined ? {} : { date }),
    tags: splitTags(form.tags),
    categories: splitTags(form.categories),
    draft: form.draft,
    ...(form.description === '' ? {} : { description: form.description }),
    ...(currentUsername(c) === undefined ? {} : { author: currentUsername(c) }),
    ...(inReplyTo === undefined ? {} : { inReplyTo }),
    extra: extraFromForm(
      kind,
      undefined,
      form,
      c.var.store.now(),
      lenientMedia(form, undefined, contentDir),
      syndicationTargetsReader(contentDir)(),
      timezone,
    ),
    body: form.body,
    html: renderMarkdown(
      form.body,
      handleDirectory(contentDir),
      permalinkBasesFromSettings(c.var.siteAtRequestStart).wiki,
    ),
    // A preview is not a version of anything, so it has no hash to be
    // mistaken for one.
    hash: '',
  };
}

/** The permalink to show: the one the form carried, or the one the slug implies. */
function permalinkFor(input: {
  type: DocumentType;
  slug: string;
  date: string | undefined;
  submitted: string;
  wikiBase: string;
}): string {
  if (input.submitted !== '' && input.type !== 'wiki') return input.submitted;
  try {
    return defaultPermalink({
      type: input.type,
      slug: input.slug,
      date: input.date,
      wikiBase: input.wikiBase,
    });
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
