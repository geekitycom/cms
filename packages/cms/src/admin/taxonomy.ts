/**
 * Managing the terms themselves: renaming a tag, merging one into another, and
 * deleting one.
 *
 * The files are the truth (doc-1), so every one of those is a rewrite of the
 * front matter of every file carrying the term rather than an edit of a row.
 * The whole of the change to one file's term list is
 * {@link applyTermChange}; everything else here is what turns that into a
 * screen and a set of announced writes.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Context, Hono } from 'hono';

import type { Document } from '../content/document.ts';
import { parseDocument } from '../content/parser.ts';
import { saveDocument } from '../content/save.ts';
import type { TermUsage } from '../content/store.ts';
import { documentContent } from '../content/writer.ts';
import type { GeekityEnv } from '../env.ts';
import {
  forgetTerm,
  recordTermRename,
  TAXONOMIES,
  TAXONOMY_LABELS,
  termHref,
} from '../web/taxonomy.ts';
import type { Taxonomy, TaxonomyRedirect } from '../web/taxonomy.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { readSiteSettings, storeSiteSettings } from './settings.ts';
import { ADMIN_PREFIX } from './session.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** Everything that differs between the tags screen and the categories screen. */
export interface TaxonomyKind {
  /** Which taxonomy the screen manages. */
  taxonomy: Taxonomy;
  /** The navigation section it marks as current. */
  section: string;
  /** Root of the screen, e.g. `/admin/tags`. */
  basePath: string;
  /** How one term is named in a sentence, e.g. `tag`. */
  singular: string;
  /** The heading over the listing, e.g. `Tags`. */
  plural: string;
}

/** The tags screen. */
export const TAG_KIND: TaxonomyKind = {
  taxonomy: 'tag',
  section: 'tags',
  basePath: `${ADMIN_PREFIX}/tags`,
  singular: 'tag',
  plural: 'Tags',
};

/** The categories screen. */
export const CATEGORY_KIND: TaxonomyKind = {
  taxonomy: 'category',
  section: 'categories',
  basePath: `${ADMIN_PREFIX}/categories`,
  singular: 'category',
  plural: 'Categories',
};

/** Both screens, in the order the navigation lists them. */
export const TAXONOMY_KINDS: readonly TaxonomyKind[] = TAXONOMIES.map((taxonomy) =>
  taxonomy === 'tag' ? TAG_KIND : CATEGORY_KIND,
);

/** Where a rename or a merge posts. */
export function renamePath(kind: TaxonomyKind): string {
  return `${kind.basePath}/rename`;
}

/** Where a row's Delete button posts. */
export function deletePath(kind: TaxonomyKind): string {
  return `${kind.basePath}/delete`;
}

/** The fields the forms on a taxonomy screen submit. */
export const TAXONOMY_FIELDS = {
  /** The term being acted on, as the files spell it. */
  term: 'term',
  /** What it is being renamed to. */
  to: 'to',
  /** Set once the admin has been shown that the rename is a merge. */
  confirm: 'confirm',
} as const;

/** What {@link mountTaxonomyScreens} needs from the admin around it. */
export interface MountTaxonomyScreensOptions {
  /** Which taxonomy the screen is for. */
  kind: TaxonomyKind;
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/**
 * Register one taxonomy's management screen: the listing, the rename (which is
 * also the merge) and the delete.
 *
 * `/admin/tags` and `/admin/categories` are this function with a different
 * {@link TaxonomyKind}, exactly as `/admin/posts` and `/admin/pages` are one
 * call to `mountDocumentScreens`: the two taxonomies are the same tables and
 * the same rewrite with a different column.
 */
export function mountTaxonomyScreens(
  app: Hono<GeekityEnv>,
  options: MountTaxonomyScreensOptions,
): void {
  const { kind, render } = options;

  app.get(kind.basePath, (c) => render(c, ADMIN_TEMPLATES.taxonomy, screen(c, kind)));

  app.post(renamePath(kind), async (c) => {
    const body = await c.req.parseBody();
    const from = field(body[TAXONOMY_FIELDS.term]).trim();
    const to = field(body[TAXONOMY_FIELDS.to]).trim();

    const problem = renameProblem({
      kind,
      from,
      to,
      exists: (term) => carriers(c, kind, term).length > 0,
    });
    if (problem !== undefined) {
      c.status(400);
      return render(
        c,
        ADMIN_TEMPLATES.taxonomy,
        screen(c, kind, { problems: { to: problem }, form: { term: from, to } }),
      );
    }

    // A rename onto a term that already exists is a merge, and a merge is not
    // undoable: it is offered rather than done, with both counts on the screen,
    // and only a form that says it has been seen goes through.
    const target = carriers(c, kind, to);
    if (target.length > 0 && field(body[TAXONOMY_FIELDS.confirm]) === '') {
      return render(
        c,
        ADMIN_TEMPLATES.taxonomy,
        screen(c, kind, {
          confirm: {
            term: from,
            to,
            files: carriers(c, kind, from).length,
            targetFiles: target.length,
          },
        }),
      );
    }

    const report = await rewriteTerm(c, kind, from, to);

    // Recorded after the rewrite, so a rename that threw writes no redirect to
    // an archive that never moved.
    await recordRedirects(c, (existing) =>
      recordTermRename(existing, { taxonomy: kind.taxonomy, from, to }),
    );

    flash(
      c,
      'notice',
      `${target.length > 0 ? 'Merged' : 'Renamed'} “${from}” ${target.length > 0 ? 'into' : 'to'} “${to}” in ${filesRewritten(report)}.${skipped(report)}`,
    );
    return c.redirect(kind.basePath, 303);
  });

  app.post(deletePath(kind), async (c) => {
    const body = await c.req.parseBody();
    const term = field(body[TAXONOMY_FIELDS.term]).trim();

    if (term === '' || carriers(c, kind, term).length === 0) {
      // Nothing was typed to send back, so this is a flash rather than a 400
      // with a form on it — the same shape a refused user deletion takes.
      flash(c, 'error', `Nothing carries the ${kind.singular} “${term}” any more.`);
      return c.redirect(kind.basePath, 303);
    }

    const report = await rewriteTerm(c, kind, term, undefined);

    // Every record pointing at the term goes with it: the archive it named is
    // about to 404, and a redirect to a 404 is worse than the 404.
    await recordRedirects(c, (existing) => forgetTerm(existing, kind.taxonomy, term));

    flash(c, 'notice', `Deleted “${term}” from ${filesRewritten(report)}.${skipped(report)}`);
    return c.redirect(kind.basePath, 303);
  });
}

/** What one rename, merge or delete did. */
export interface TermRewriteReport {
  /** How many files were written. */
  rewritten: number;
  /** Files that could not be read or parsed, and so were left alone. */
  skipped: string[];
}

/**
 * Rewrite every file carrying `from` so it carries `to` instead — or, when `to`
 * is `undefined`, so it carries neither.
 *
 * Each file is read and re-parsed from disk rather than taken out of the index
 * (doc-1: the files are the truth). The index can be a moment behind — a hand
 * edit the watcher has not seen yet — and a bulk rewrite that trusted it would
 * quietly put that edit back. A file that has gone or will not parse is
 * skipped and reported rather than overwritten with what the index remembers.
 *
 * Every write is announced, awaited one at a time, so the index, the feeds,
 * the notify server and one `Update(Article)` per affected published post all
 * follow — the hashtags on those posts have just changed.
 */
export async function rewriteTerm(
  c: Context<GeekityEnv>,
  kind: TaxonomyKind,
  from: string,
  to: string | undefined,
): Promise<TermRewriteReport> {
  const contentDir = c.var.config.contentDir;
  const store = c.var.store;
  const report: TermRewriteReport = { rewritten: 0, skipped: [] };

  for (const indexed of carriers(c, kind, from)) {
    const file = path.join(contentDir, ...indexed.path.split('/'));

    let document: Document;
    try {
      document = parseDocument(await readFile(file, 'utf8'), {
        path: indexed.path,
        type: indexed.type,
      });
    } catch {
      report.skipped.push(indexed.path);
      continue;
    }

    const terms = changedTerms(document, kind.taxonomy, from, to);
    if (terms === undefined) continue;

    const saved = await saveDocument({
      contentDir,
      store,
      path: indexed.path,
      content: {
        ...documentContent(document),
        ...(kind.taxonomy === 'tag' ? { tags: terms } : { categories: terms }),
      },
    });

    report.rewritten += 1;
    await c.var.announce({
      type: 'updated',
      path: saved.path,
      previous: document,
      next: saved,
      origin: 'admin',
    });
  }

  return report;
}

/**
 * Every indexed document carrying a term, trash included.
 *
 * Two queries rather than one because `listAll` shows the live tree or the
 * trash and never both, and a rename has to reach a trashed file: it may be
 * restored tomorrow, and it would come back carrying a term nothing else uses.
 */
function carriers(c: Context<GeekityEnv>, kind: TaxonomyKind, term: string): Document[] {
  const filter = kind.taxonomy === 'tag' ? { tag: term } : { category: term };
  return [
    ...c.var.store.listAll({ ...filter, trashed: false }),
    ...c.var.store.listAll({ ...filter, trashed: true }),
  ];
}

/** What is wrong with a proposed rename, or `undefined` when nothing is. */
export function renameProblem(input: {
  kind: TaxonomyKind;
  from: string;
  to: string;
  /** Whether a term is carried by anything at all. */
  exists: (term: string) => boolean;
}): string | undefined {
  const { kind, from, to } = input;
  if (from === '') return `Name the ${kind.singular} to rename.`;
  if (!input.exists(from)) return `Nothing carries the ${kind.singular} “${from}” any more.`;
  if (to === '') return `A ${kind.singular} needs a name.`;
  if (to === from) return `“${to}” is what it is called already.`;
  return undefined;
}

/** "1 file" or "4 files", for the flash. */
function filesRewritten(report: TermRewriteReport): string {
  return report.rewritten === 1 ? '1 file' : `${String(report.rewritten)} files`;
}

/** The sentence a flash adds about files it could not read. Usually nothing. */
function skipped(report: TermRewriteReport): string {
  if (report.skipped.length === 0) return '';
  return ` ${String(report.skipped.length)} could not be read and were left alone: ${report.skipped.join(', ')}.`;
}

/**
 * Rewrite the recorded archive renames, in SQLite and in
 * `content/_data/site.json`.
 *
 * The whole settings object is read and written back, rather than the one key,
 * because that is the one write path the settings screen uses too: the file is
 * a mirror of the settings and rewriting it from anything less would drop
 * whatever else had been saved.
 */
async function recordRedirects(
  c: Context<GeekityEnv>,
  change: (existing: readonly TaxonomyRedirect[]) => TaxonomyRedirect[],
): Promise<void> {
  const settings = readSiteSettings(c.var.admin);
  const taxonomyRedirects = change(settings.taxonomyRedirects);

  await storeSiteSettings({
    admin: c.var.admin,
    contentDir: c.var.config.contentDir,
    settings: { ...settings, taxonomyRedirects },
  });
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function field(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Everything the taxonomy template renders. */
function screen(
  c: Context<GeekityEnv>,
  kind: TaxonomyKind,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const bases = c.var.renderer.taxonomyBases();

  return {
    section: kind.section,
    kind,
    heading: kind.plural,
    listUrl: kind.basePath,
    renameUrl: renamePath(kind),
    deleteUrl: deletePath(kind),
    fields: TAXONOMY_FIELDS,
    label: TAXONOMY_LABELS[kind.taxonomy],
    terms: c.var.store.listTermUsage(kind.taxonomy).map((usage) => ({
      ...usage,
      archiveUrl: termHref({ taxonomy: kind.taxonomy, term: usage.term }, 0, bases),
    })),
    problems: {},
    form: { term: '', to: '' },
    ...extra,
  };
}

/** One term as the screen shows it. */
export type TermRow = TermUsage & { archiveUrl: string };

/** A document as it will be after a term change, or `undefined` when it is unchanged. */
export function changedTerms(
  document: Pick<Document, 'tags' | 'categories'>,
  taxonomy: Taxonomy,
  from: string,
  to: string | undefined,
): string[] | undefined {
  const before = taxonomy === 'tag' ? document.tags : document.categories;
  const after = applyTermChange(before, from, to);
  if (after.length === before.length && after.every((term, index) => term === before[index])) {
    return undefined;
  }
  return after;
}

/**
 * One document's term list after a rename, a merge or a delete.
 *
 * The three are one operation. `to` replaces `from` where it stands, so a
 * rename keeps the order the file had; a `to` the list already carries is a
 * merge, and then `from` is simply dropped and the target keeps the place it
 * already had rather than jumping to the source's; a `to` of `undefined` is a
 * delete. A list that does not carry `from` comes back as it was.
 */
export function applyTermChange(
  terms: readonly string[],
  from: string,
  to: string | undefined,
): string[] {
  // A merge is a removal rather than a substitution: the target is already in
  // the list somewhere, and moving it to where the source stood would reorder
  // a file for no reason anybody asked for.
  const merging = to !== undefined && to !== from && terms.includes(to);

  const changed: string[] = [];
  for (const term of terms) {
    const next = term === from ? (merging ? undefined : to) : term;
    if (next === undefined) continue;
    if (!changed.includes(next)) changed.push(next);
  }

  return changed;
}
