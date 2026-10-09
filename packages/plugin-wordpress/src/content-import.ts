import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  PluginCommandContext,
  PluginComment,
  PluginDataFolder,
  PluginSite,
} from '@geekity/cms/plugin';

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

/**
 * One key of a JSON object file the site also writes, such as `homepage` in
 * `_data/site.json` or an upload's alt text in `_data/media.json`. The import
 * owns the key, never the file.
 */
export interface DataEntry {
  readonly item: WordPressItem;
  /** Relative to the content directory, like {@link ImportedFile.path}. */
  readonly file: string;
  readonly key: string;
  readonly value: unknown;
}

export interface ImportedComment {
  readonly item: WordPressItem;
  readonly permalink: string;
  readonly comment: PluginComment;
  readonly label: string;
}

export interface ImporterOutput {
  readonly files: readonly ImportedFile[];
  readonly notes: readonly ItemNote[];
  readonly entries?: readonly DataEntry[] | undefined;
  readonly comments?: readonly ImportedComment[] | undefined;
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

export const IMPORT_RECORD_FILE = 'import.json';

/**
 * The redirects the import declares, one key per old URL, in a file of their
 * own beside the site's `_data/redirects.json`, which the import never touches.
 */
export const IMPORT_REDIRECTS_FILE = '_data/redirects/wordpress.json';

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
  const entries: DataEntry[] = [];
  const comments: ImportedComment[] = [];
  for (const importer of importers) {
    const output = await importer.import(exported, context);
    files.push(...output.files);
    rows.push(...output.notes);
    entries.push(...(output.entries ?? []));
    comments.push(...(output.comments ?? []));
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
  const byFile = new Map<ContentPath, DataEntry[]>();
  for (const entry of entries) {
    const file = contentPath(entry.file);
    byFile.set(file, [...(byFile.get(file) ?? []), entry]);
  }
  for (const [file, inFile] of byFile) {
    rows.push(...(await writeEntries(contentDir, file, inFile, record, data)));
  }
  const byPost = new Map<string, ImportedComment[]>();
  for (const comment of comments) {
    byPost.set(comment.permalink, [...(byPost.get(comment.permalink) ?? []), comment]);
  }
  for (const [permalink, onPost] of byPost) {
    rows.push(...(await writeComments(context.site, permalink, onPost, record, data)));
  }

  const order = new Map(exported.items.map((item, index) => [item, index]));
  rows.sort((a, b) => (order.get(a.item) ?? 0) - (order.get(b.item) ?? 0));
  return { rows };
}

type ContentPath = string;
type Sha256 = string;
type EntryKey = string;
type JsonText = string;
type CommentId = string;

interface ImportRecord {
  readonly files: Map<ContentPath, Sha256>;
  readonly entries: Map<ContentPath, Map<EntryKey, JsonText>>;
  readonly comments: Map<ContentPath, Map<CommentId, Sha256>>;
}

interface SavedRecord {
  files?: Record<ContentPath, Sha256>;
  entries?: Record<ContentPath, Record<EntryKey, JsonText>>;
  comments?: Record<ContentPath, Record<CommentId, Sha256>>;
}

function readRecord(data: PluginDataFolder): ImportRecord {
  const text = data.read(IMPORT_RECORD_FILE);
  const parsed = text === undefined ? {} : (JSON.parse(text) as SavedRecord);
  const nested = <Value>(saved: Record<string, Record<string, Value>> | undefined) =>
    new Map(
      Object.entries(saved ?? {}).map(([file, keys]) => [file, new Map(Object.entries(keys))]),
    );
  return {
    files: new Map(Object.entries(parsed.files ?? {})),
    entries: nested(parsed.entries),
    comments: nested(parsed.comments),
  };
}

async function saveRecord(data: PluginDataFolder, record: ImportRecord): Promise<void> {
  const sorted = <Value>(map: ReadonlyMap<string, Value>) =>
    Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : 1)));
  const nested = <Value>(map: ReadonlyMap<string, ReadonlyMap<string, Value>>) =>
    Object.fromEntries(
      [...map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([file, keys]) => [file, sorted(keys)]),
    );
  const saved: SavedRecord = { files: sorted(record.files) };
  if (record.entries.size > 0) saved.entries = nested(record.entries);
  if (record.comments.size > 0) saved.comments = nested(record.comments);
  await data.update(IMPORT_RECORD_FILE, () => `${JSON.stringify(saved, null, 2)}\n`);
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
  const recorded = record.files.get(relative);
  const next = sha256(file.contents);
  const decision = decide(current === undefined ? undefined : sha256(current), recorded, next);

  if (decision.action === 'write') await writeAtomically(absolute, file.contents);
  if (decision.action !== 'leave' && recorded !== next) {
    record.files.set(relative, next);
    await saveRecord(data, record);
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

async function writeEntries(
  contentDir: string,
  file: ContentPath,
  entries: readonly DataEntry[],
  record: ImportRecord,
  data: PluginDataFolder,
): Promise<ReportRow[]> {
  const absolute = path.join(contentDir, file);
  const text = await readIfPresent(absolute);
  const held =
    text === undefined ? {} : (JSON.parse(text.toString('utf8')) as Record<string, unknown>);
  const recordedKeys = record.entries.get(file) ?? new Map<EntryKey, JsonText>();
  const name = path.posix.basename(file);

  const rows: ReportRow[] = [];
  let changed = false;
  for (const { item, key, value } of entries) {
    const next = JSON.stringify(value);
    const current = held[key] === undefined ? undefined : JSON.stringify(held[key]);
    const recorded = recordedKeys.get(key);
    const decision = decide(current, recorded, next);
    if (decision.action === 'write') {
      held[key] = value;
      changed = true;
    }
    if (decision.action !== 'leave' && recorded !== next) {
      recordedKeys.set(key, next);
      record.entries.set(file, recordedKeys);
      await saveRecord(data, record);
    }
    let why = `${key} is ${next}`;
    if (decision.outcome === 'clash') {
      why = `${name} already sets ${key} to ${current ?? ''}; it was left alone`;
    } else if (decision.action === 'leave') {
      why = `${key} was changed on this site to ${current ?? ''}; it was left alone`;
    }
    rows.push({ outcome: decision.outcome, item, path: file, why });
  }
  if (changed) await writeAtomically(absolute, `${JSON.stringify(held, null, 2)}\n`);
  return rows;
}

async function writeComments(
  site: PluginSite,
  permalink: string,
  comments: readonly ImportedComment[],
  record: ImportRecord,
  data: PluginDataFolder,
): Promise<ReportRow[]> {
  const held = site.comments(permalink);
  const current = new Map(held.comments.map((comment) => [comment.id, sha256(canonical(comment))]));
  const recorded = record.comments.get(held.file) ?? new Map<CommentId, Sha256>();

  const rows: ReportRow[] = [];
  const writes: PluginComment[] = [];
  for (const { item, comment, label } of comments) {
    const now = current.get(comment.id);
    const before = recorded.get(comment.id);
    const next = sha256(canonical(comment));
    const deletedHere = now === undefined && before !== undefined;
    const decision: Decision = deletedHere
      ? { action: 'leave', outcome: 'kept', why: 'deleted on this site; left out' }
      : decide(now, before, next);
    if (decision.action === 'write') writes.push(comment);
    if (decision.action !== 'leave') recorded.set(comment.id, next);
    rows.push({
      outcome: decision.outcome,
      item,
      path: held.file,
      why: `${label}: ${decision.why}`,
    });
  }

  await site.putComments(permalink, writes);
  if (recorded.size > 0) record.comments.set(held.file, recorded);
  await saveRecord(data, record);
  return rows;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : inner,
  );
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
