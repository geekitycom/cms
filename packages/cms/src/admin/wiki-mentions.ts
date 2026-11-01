import type { Context } from 'hono';

import type { Document, DocumentType } from '../content/document.ts';
import { formFor } from '../content/document-form.ts';
import { PAGE_KIND, POST_KIND, WIKI_KIND } from '../content/document-kind.ts';
import type { DocumentKind } from '../content/document-kind.ts';
import { postLocations } from '../content/locations.ts';
import { postLabel } from '../content/post-type.ts';
import { scheduledFor } from '../content/schedule.ts';
import { isFederatedDocument } from '../content/served.ts';
import { isTrashedPath } from '../content/store.ts';
import { linkMention, mentionTargetOf, unlinkedMention } from '../content/wiki-mentions.ts';
import type { Mention, MentionTarget } from '../content/wiki-mentions.ts';
import { writeDocument } from '../content/write.ts';
import { documentSite } from '../web/document-site.ts';
import type { GeekityEnv } from '../web/env.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { flash } from './flash.ts';

/** The field a Link button submits: the path of the document to link. */
export const LINK_FIELD = 'link';
/** The field the Link all button submits. */
export const LINK_ALL_FIELD = 'link-all';

const KINDS: Readonly<Record<DocumentType, DocumentKind>> = {
  post: POST_KIND,
  page: PAGE_KIND,
  wiki: WIKI_KIND,
};

/** One document in the Unlinked mentions panel. */
export interface MentionRow {
  readonly path: string;
  readonly type: DocumentType;
  readonly slug: string;
  readonly title: string;
  readonly status: 'Draft' | 'Scheduled' | 'Published';
  /** Whether saving it sends followers an update. */
  readonly federated: boolean;
  readonly before: string;
  readonly text: string;
  readonly after: string;
}

interface Found {
  readonly document: Document;
  readonly mention: Mention;
}

/**
 * Every live post, page and wiki page but the page itself, drafts included,
 * that mentions the page without linking to it, by title.
 */
export function mentionRows(c: Context<GeekityEnv>, page: Document): MentionRow[] {
  const now = c.var.store.now();
  return unlinkedMentions(c, page).map(({ document, mention }) => ({
    path: document.path,
    type: document.type,
    slug: document.slug,
    title: label(c, document),
    status: document.draft
      ? 'Draft'
      : scheduledFor(document, now) === undefined
        ? 'Published'
        : 'Scheduled',
    federated: isFederatedDocument(document, now),
    ...around(document.body, mention),
  }));
}

/**
 * Link the documents a Link or Link all button asked for, each from its
 * current text, and say what happened in flashes.
 */
export async function linkMentions(
  c: Context<GeekityEnv>,
  page: Document,
  form: Record<string, unknown>,
): Promise<void> {
  const target = mentionTargetOf(page);
  const paths =
    form[LINK_ALL_FIELD] === undefined
      ? [stringOrEmpty(form[LINK_FIELD])]
      : unlinkedMentions(c, page).map(({ document }) => document.path);

  const linked: string[] = [];
  for (const path of paths) {
    const document = c.var.store.getByPath(path);
    if (document === undefined || isTrashedPath(document.path) || document.path === page.path) {
      flash(c, 'warning', 'That document cannot be linked from here.');
      continue;
    }
    const outcome = await linkFirstMention(c, document, target);
    if (outcome === 'linked') linked.push(label(c, document));
    else flash(c, outcome.kind, outcome.message);
  }

  if (linked.length > 0) {
    const noun = linked.length === 1 ? 'document' : 'documents';
    flash(c, 'notice', `Linked ${String(linked.length)} ${noun}: ${linked.join(', ')}`);
  }
}

/**
 * Wrap the first unlinked mention in a document as it reads now, and save it
 * the way the editor does, with the hash it was read with, so a file that
 * moved on since is refused rather than overwritten.
 */
async function linkFirstMention(
  c: Context<GeekityEnv>,
  document: Document,
  target: MentionTarget,
): Promise<'linked' | { kind: 'warning' | 'error'; message: string }> {
  const name = label(c, document);
  const mention = unlinkedMention(document.body, target);
  if (mention === undefined) {
    return {
      kind: 'warning',
      message: `${name} no longer mentions this page without linking to it.`,
    };
  }

  const kind = KINDS[document.type];
  const location = postLocations(c.var.config.dataDir).read(document.permalink);
  const form = formFor(kind, document, c.var.siteAtRequestStart.timezone, location);
  const written = await writeDocument(documentSite(c), {
    kind,
    document,
    form: { ...form, body: linkMention(document.body, mention, target) },
    draft: document.draft,
  });

  switch (written.outcome) {
    case 'saved':
      return 'linked';
    case 'conflict':
      return {
        kind: 'error',
        message: `${name} changed on disk since it was last read, so it was not linked. Try again once it has been read again.`,
      };
    case 'refused':
      return { kind: 'error', message: `${name} was not linked: ${written.message}` };
  }
}

function unlinkedMentions(c: Context<GeekityEnv>, page: Document): Found[] {
  const target = mentionTargetOf(page);
  const found: Found[] = [];
  for (const document of c.var.store.listAll({ draft: undefined, trashed: false })) {
    if (document.path === page.path) continue;
    const mention = unlinkedMention(document.body, target);
    if (mention !== undefined) found.push({ document, mention });
  }
  return found.sort((a, b) => label(c, a.document).localeCompare(label(c, b.document)));
}

function label(c: Context<GeekityEnv>, document: Document): string {
  return postLabel(document, (url) => c.var.replyContexts.read(url, c.var.siteAtRequestStart));
}

const CONTEXT = 60;

/** The words either side of a mention, on one line. */
function around(body: string, mention: Mention): { before: string; text: string; after: string } {
  const start = Math.max(0, mention.from - CONTEXT);
  const end = Math.min(body.length, mention.to + CONTEXT);
  let before = oneLine(body.slice(start, mention.from));
  let after = oneLine(body.slice(mention.to, end));
  if (start > 0) before = `…${before.replace(/^\S*\s/, '')}`;
  if (end < body.length) after = `${after.replace(/\s\S*$/, '')}…`;
  return { before, text: mention.text, after };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ');
}
