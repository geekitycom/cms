import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PluginCommandContext, PluginDataFolder } from '@geekity/cms/plugin';

import type { WordPressExport, WordPressItem } from './wxr.ts';

export interface ImportedFile {
  readonly item: WordPressItem;
  /** Relative to the content directory, with `/` between segments, such as `posts/2024-03-05-hello.md`. */
  readonly path: string;
  readonly contents: string | Uint8Array;
}

/** Why an importer left an item out, or what the operator should know about one it took. */
export interface ItemNote {
  readonly item: WordPressItem;
  readonly outcome: 'skipped' | 'warned';
  readonly why: string;
}

export interface ImporterOutput {
  readonly files: readonly ImportedFile[];
  readonly notes: readonly ItemNote[];
}

/**
 * One kind of thing the import brings across. It sees the whole export, since
 * a post's body needs the attachments and a redirect needs every permalink,
 * and the command's context, for the site's users and the options it takes.
 */
export interface WordPressImporter {
  /** The post types it handles. An item whose type no importer claims is skipped. */
  readonly postTypes: readonly string[];
  import(
    exported: WordPressExport,
    context: PluginCommandContext,
  ): ImporterOutput | Promise<ImporterOutput>;
}

export const SKIPPED_POST_TYPES: Readonly<Record<string, string>> = {
  revision: 'an earlier version of a post; the import takes the current one',
  oembed_cache: "WordPress's cache of embed answers; Geekity fetches its own",
  nav_menu_item: 'a navigation menu entry; a Geekity theme draws its own menu',
  wp_navigation: 'a block navigation menu; a Geekity theme draws its own menu',
  wp_global_styles: "the block theme's styles; a Geekity theme carries its own",
  wp_template: 'a block theme template; a Geekity theme carries its own',
  wp_template_part: 'a block theme template part; a Geekity theme carries its own',
  wp_font_family: 'a font installed into the block theme',
  wp_font_face: 'a font installed into the block theme',
  custom_css: "the Customizer's extra CSS; put it in a Geekity theme",
  customize_changeset: 'an unsaved Customizer session',
  user_request: 'a personal data export or erasure request',
  wp_block: 'a reusable block; its content is already in each post that used it',
  ap_actor: "the ActivityPub plugin's cache of a remote actor",
  ap_inbox: "the ActivityPub plugin's record of an incoming activity",
  ap_outbox: "the ActivityPub plugin's record of an outgoing activity",
  ap_extrafield: "an ActivityPub plugin profile field; carry it to the user's profile by hand",
  ap_extrafield_blog:
    "an ActivityPub plugin blog profile field; carry it to the site's profile by hand",
  ap_post: "the ActivityPub plugin's copy of a remote post",
  feedback: 'a contact form submission; Geekity keeps its own',
};

/** What happened to one item, or to one file an item produced. */
export type Outcome =
  'written' | 'unchanged' | 'kept' | 'conflict' | 'clash' | 'skipped' | 'warned';

export interface ReportRow {
  readonly outcome: Outcome;
  readonly item: WordPressItem;
  readonly path?: string | undefined;
  readonly why: string;
}

export interface ImportReport {
  /** In the export's order, each item's rows together. */
  readonly rows: readonly ReportRow[];
}

const IMPORT_RECORD_FILE = 'import.json';

export async function importWordPressContent(options: {
  exported: WordPressExport;
  context: PluginCommandContext;
  data: PluginDataFolder;
  importers: readonly WordPressImporter[];
}): Promise<ImportReport> {
  const { exported, context, data, importers } = options;
  const contentDir = context.site.contentDir;

  const claimed = new Set(importers.flatMap((importer) => importer.postTypes));
  const rows: ReportRow[] = exported.items
    .filter((item) => !claimed.has(item.type))
    .map((item) => ({
      outcome: 'skipped',
      item,
      why: SKIPPED_POST_TYPES[item.type] ?? `there is no importer for ${item.type} items`,
    }));

  const files: ImportedFile[] = [];
  for (const importer of importers) {
    const output = await importer.import(exported, context);
    files.push(...output.files);
    rows.push(...output.notes);
  }

  const record = readRecord(data);
  const seen = new Set<string>();
  for (const file of files) {
    const relative = contentPath(file.path);
    if (seen.has(relative)) {
      throw new Error(`Two importers both write ${relative}; each path has one owner.`);
    }
    seen.add(relative);
    rows.push(await writeOne(contentDir, relative, file, record, data));
  }

  const order = new Map(exported.items.map((item, index) => [item, index]));
  rows.sort((a, b) => (order.get(a.item) ?? 0) - (order.get(b.item) ?? 0));
  return { rows };
}

type ContentPath = string;
type Sha256 = string;
type ImportRecord = Map<ContentPath, Sha256>;

function readRecord(data: PluginDataFolder): ImportRecord {
  const text = data.read(IMPORT_RECORD_FILE);
  if (text === undefined) return new Map();
  const parsed = JSON.parse(text) as { files?: Record<string, string> };
  return new Map(Object.entries(parsed.files ?? {}));
}

async function remember(
  data: PluginDataFolder,
  record: ImportRecord,
  relative: ContentPath,
  hash: Sha256,
): Promise<void> {
  record.set(relative, hash);
  const files = Object.fromEntries([...record].sort(([a], [b]) => (a < b ? -1 : 1)));
  await data.update(IMPORT_RECORD_FILE, () => `${JSON.stringify({ files }, null, 2)}\n`);
}

interface Decision {
  readonly action: 'write' | 'adopt' | 'leave';
  readonly outcome: Outcome;
  readonly why: string;
}

function decide(current: Sha256 | undefined, recorded: Sha256 | undefined, next: Sha256): Decision {
  if (current === undefined) {
    return {
      action: 'write',
      outcome: 'written',
      why: recorded === undefined ? 'new' : 'removed on this site, written again',
    };
  }
  if (current === next) {
    return { action: 'adopt', outcome: 'unchanged', why: 'already as WordPress has it' };
  }
  if (recorded === undefined) {
    return {
      action: 'leave',
      outcome: 'clash',
      why: 'a file not written by the import is already there; it was left alone',
    };
  }
  if (current === recorded) {
    return {
      action: 'write',
      outcome: 'written',
      why: 'changed on WordPress since the last import',
    };
  }
  return next === recorded
    ? {
        action: 'leave',
        outcome: 'kept',
        why: 'WordPress has not changed it since the last import',
      }
    : { action: 'leave', outcome: 'conflict', why: "this site's version was kept" };
}

async function writeOne(
  contentDir: string,
  relative: ContentPath,
  file: ImportedFile,
  record: ImportRecord,
  data: PluginDataFolder,
): Promise<ReportRow> {
  const absolute = path.join(contentDir, relative);
  const current = await readIfPresent(absolute);
  const recorded = record.get(relative);
  const next = sha256(file.contents);
  const decision = decide(current === undefined ? undefined : sha256(current), recorded, next);

  if (decision.action === 'write') await writeAtomically(absolute, file.contents);
  if (decision.action !== 'leave' && recorded !== next) {
    await remember(data, record, relative, next);
  }

  let why = decision.why;
  if (decision.outcome === 'kept' || decision.outcome === 'conflict') {
    const editedAt = (await stat(absolute)).mtime.toISOString();
    const changedAt = file.item.modifiedGmt ?? file.item.dateGmt ?? 'an unknown time';
    why =
      decision.outcome === 'kept'
        ? `edited on this site at ${editedAt}; ${why}`
        : `edited on this site at ${editedAt}, and changed on WordPress at ${changedAt}; ${why}`;
  }
  return { outcome: decision.outcome, item: file.item, path: relative, why };
}

function contentPath(given: string): string {
  const normalised = path.posix.normalize(given);
  if (path.posix.isAbsolute(normalised) || normalised.startsWith('../') || normalised === '..') {
    throw new Error(
      `${given} is outside the content directory; an importer writes only inside it.`,
    );
  }
  return normalised;
}

async function readIfPresent(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeAtomically(file: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid.toString(36)}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, file);
}

function sha256(contents: string | Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex');
}
