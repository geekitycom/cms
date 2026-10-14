import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, open, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGzip, gzipSync } from 'node:zlib';

import type { ResolvedConfig } from '../config.ts';
import {
  CONTENT_SCRATCH_FILES,
  JOBS,
  classifyEntries,
  classifyFiles,
  dataPath,
} from '../files/data-files.ts';
import { TAR_END, tarHeader, tarPadding } from '../files/tar.ts';
import { ownManifest } from '../init.ts';
import { createFileRecords } from '../jobs/file-records.ts';
import { siteDataFiles } from '../plugins/data.ts';
import { readEnabledPlugins } from '../plugins/enabled.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import { DEV_MODE } from '../settings/dev-mode.ts';
import { overridden, sourceLabel } from '../settings/registry.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { countWaitingMessages } from '../store/queue-database.ts';

/**
 * `geekity export` and the admin's export job (decision-55, section 4): a
 * gzipped tar of `content/` without scratch and of every `kept` file under
 * `data/`, credentials only when asked, with `manifest.json` first.
 *
 * It reads only. Every writer replaces its file by rename, so each file read
 * through one open handle is a whole file, and its hash is taken from the
 * bytes the archive holds. SQLite files are never exported.
 */

export const EXPORT_FORMAT = 1;

export const MANIFEST_NAME = 'manifest.json';

/** The site a running server or a command has booted. */
export interface SiteExportSource {
  readonly config: Pick<ResolvedConfig, 'dataDir' | 'contentDir' | 'baseUrl' | 'plugins'>;
  readonly settings: SettingsRegistry;
  readonly plugins: PluginRegistry;
}

export interface SiteExportOptions {
  readonly withCredentials: boolean;
  readonly withContent: boolean;
}

export type ExportedClass = 'kept' | 'credential';

export interface ManifestFile {
  /** In the archive: `content/…` or `data/…`. */
  readonly path: string;
  readonly class: ExportedClass;
  readonly size: number;
  readonly sha256: string;
}

export interface ManifestPlugin {
  readonly name: string;
  readonly version: string;
  /** `folder` for one in the plugins folder, `config` for one the site's config names. */
  readonly source: 'folder' | 'config';
  readonly enabled: boolean;
}

export interface ManifestOverride {
  /** `namespace.key`. */
  readonly setting: string;
  /** `env GEEKITY_…` or `config field`. Never the value. */
  readonly source: string;
}

export interface PendingWork {
  /** Messages waiting in `data/queue.sqlite`, which is never exported. */
  readonly deliveries: number;
  readonly jobs: { readonly queued: number; readonly running: number };
}

export interface NotCarried {
  /** In the archive's terms: `content/…`. */
  readonly path: string;
  /** What it is: `a symbolic link`, `a socket`, `a FIFO` or `a device`. */
  readonly why: string;
}

export interface ExportManifest {
  readonly format: typeof EXPORT_FORMAT;
  readonly cms: string;
  readonly exportedAt: string;
  readonly baseUrl: string;
  readonly content: boolean;
  readonly credentials: boolean;
  readonly devMode: boolean;
  /** Every file in the archive after the manifest, in archive order. */
  readonly files: readonly ManifestFile[];
  /** Files under `data/` that no declaration covers. They are not in the archive. */
  readonly undeclared: readonly string[];
  /** Entries under `content/` that are not regular files, such as a symbolic link. They are not in the archive. */
  readonly notCarried: readonly NotCarried[];
  /** The settings namespaces and plugins whose credential files held something and were left out. */
  readonly credentialsLeftOut: readonly string[];
  readonly plugins: readonly ManifestPlugin[];
  readonly overrides: readonly ManifestOverride[];
  readonly pending: PendingWork;
}

interface PlannedFile {
  readonly path: string;
  readonly absolute: string;
  readonly class: ExportedClass;
}

/** What an export will hold, worked out before any byte is written. */
export interface ExportPlan {
  readonly files: readonly PlannedFile[];
  /** The files' sizes when they were planned. */
  readonly bytes: number;
  readonly site: Omit<ExportManifest, 'exportedAt' | 'files'>;
}

export interface ExportProgress {
  readonly files: number;
  readonly totalFiles: number;
  readonly bytes: number;
  readonly totalBytes: number;
}

export interface WriteSiteExportOptions {
  /** The archive to write. It is replaced whole, at mode 0600. */
  readonly out: string;
  readonly now: Date;
  /** Checked between files; an abort rejects with its reason and leaves no file behind. */
  readonly signal?: AbortSignal;
  /** Called after each file. */
  readonly progress?: (progress: ExportProgress) => void | Promise<void>;
}

/** The work a move has to wait for: deliveries in the queue, and jobs not yet done. */
export async function pendingWork(dataDir: string): Promise<PendingWork> {
  const jobs = await createFileRecords(dataPath(dataDir, JOBS)).list(['queued', 'running']);
  return {
    deliveries: countWaitingMessages(dataDir),
    jobs: {
      queued: jobs.filter((job) => job.state === 'queued').length,
      running: jobs.filter((job) => job.state === 'running').length,
    },
  };
}

/** `<yyyymmdd>T<hhmmss>Z`, for a file name. */
export function compactTime(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/** `geekity-<host>-<yyyymmdd>T<hhmmss>Z.tar.gz`. */
export function exportFileName(baseUrl: string, now: Date): string {
  return `geekity-${new URL(baseUrl).hostname}-${compactTime(now)}.tar.gz`;
}

/** The namespace a credential file belongs to: the plugin's name under `plugins/`, else the file's. */
function credentialOwner(relative: string): string {
  const [first, second, third] = relative.split('/');
  if (first === 'plugins' && second !== undefined) {
    return second.startsWith('@') && third !== undefined ? `${second}/${third}` : second;
  }
  return (relative.split('/').at(-1) ?? relative).replace(/\.json$/, '');
}

async function overridesOf(settings: SettingsRegistry): Promise<ManifestOverride[]> {
  const found: ManifestOverride[] = [];
  for (const ref of settings.list()) {
    const { source } = await settings.resolve(ref);
    if (overridden(source)) {
      found.push({ setting: `${ref.namespace}.${ref.key}`, source: sourceLabel(source) });
    }
  }
  return found;
}

function pluginsOf(source: SiteExportSource): ManifestPlugin[] {
  const enabled = readEnabledPlugins(source.config.contentDir);
  const fromConfig = new Set(source.config.plugins.map((plugin) => plugin.name));
  return source.plugins.plugins.map(({ plugin }) => ({
    name: plugin.name,
    version: plugin.version,
    source: fromConfig.has(plugin.name) ? 'config' : 'folder',
    enabled: enabled.has(plugin.name),
  }));
}

/**
 * Walk `content/` and `data/` and decide each file by its class: `kept` goes
 * in, `credential` goes in only when asked, and the rest stay out. A file
 * under `data/` that nothing declares stays out and is named, and so does an
 * entry under `content/` that is not a regular file.
 */
export async function planSiteExport(
  source: SiteExportSource,
  options: SiteExportOptions,
): Promise<ExportPlan> {
  const { contentDir, dataDir, baseUrl } = source.config;
  const files: PlannedFile[] = [];
  const undeclared: string[] = [];
  const notCarried: NotCarried[] = [];
  const leftOut = new Set<string>();

  if (options.withContent) {
    const entries = classifyEntries(contentDir, CONTENT_SCRATCH_FILES);
    for (const file of entries.files) {
      if (file.declaration === undefined) {
        files.push({ path: `content/${file.relative}`, absolute: file.absolute, class: 'kept' });
      }
    }
    for (const other of entries.others) {
      if (other.declaration === undefined) {
        notCarried.push({ path: `content/${other.relative}`, why: other.kind });
      }
    }
  }

  const declarations = siteDataFiles({
    dataDir,
    settings: source.settings,
    plugins: source.plugins,
  });
  for (const file of classifyFiles(dataDir, declarations)) {
    const archived = `data/${file.relative}`;
    const kind = file.declaration?.dataClass.kind;
    switch (kind) {
      case undefined:
        undeclared.push(archived);
        break;
      case 'kept':
        files.push({ path: archived, absolute: file.absolute, class: 'kept' });
        break;
      case 'credential':
        if (options.withCredentials) {
          files.push({ path: archived, absolute: file.absolute, class: 'credential' });
        } else if ((await stat(file.absolute)).size > 0) {
          leftOut.add(credentialOwner(file.relative));
        }
        break;
      case 'rebuildable':
      case 'pending':
      case 'scratch':
        break;
      default:
        kind satisfies never;
    }
  }

  let bytes = 0;
  for (const file of files) bytes += (await stat(file.absolute)).size;

  return {
    files,
    bytes,
    site: {
      format: EXPORT_FORMAT,
      cms: ownManifest().version,
      baseUrl,
      content: options.withContent,
      credentials: options.withCredentials,
      devMode: await source.settings.get(DEV_MODE.on),
      undeclared,
      notCarried,
      credentialsLeftOut: [...leftOut].sort(),
      plugins: pluginsOf(source),
      overrides: await overridesOf(source.settings),
      pending: await pendingWork(dataDir),
    },
  };
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function* tarEntries(
  plan: ExportPlan,
  recorded: ManifestFile[],
  options: WriteSiteExportOptions,
): AsyncGenerator<Buffer> {
  let bytes = 0;
  for (const [index, file] of plan.files.entries()) {
    options.signal?.throwIfAborted();
    let handle;
    try {
      handle = await open(file.absolute, 'r');
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (handle !== undefined) {
      try {
        const { size, mode, mtime } = await handle.stat();
        yield tarHeader({ name: file.path, mode, size, mtime });
        const hash = createHash('sha256');
        let read = 0;
        if (size > 0) {
          const stream = handle.createReadStream({ start: 0, end: size - 1, autoClose: false });
          for await (const chunk of stream as AsyncIterable<Buffer>) {
            hash.update(chunk);
            read += chunk.length;
            yield chunk;
          }
        }
        if (read !== size) {
          throw new Error(
            `${file.path} was cut short while it was read. A writer changed it in place; export again.`,
          );
        }
        yield tarPadding(size);
        recorded.push({ path: file.path, class: file.class, size, sha256: hash.digest('hex') });
        bytes += size;
      } finally {
        await handle.close();
      }
    }
    await options.progress?.({
      files: index + 1,
      totalFiles: plan.files.length,
      bytes,
      totalBytes: plan.bytes,
    });
  }
  yield TAR_END;
}

/**
 * Write the archive the plan describes. The files go through gzip into a
 * temporary file beside `out` while they are hashed; then `manifest.json`,
 * which needs those hashes, is written as the first gzip member and the files
 * follow as the second. gzip readers and tar take the two members as one
 * stream. The finished file is renamed onto `out`.
 */
export async function writeSiteExport(
  plan: ExportPlan,
  options: WriteSiteExportOptions,
): Promise<ExportManifest> {
  const { now } = options;
  const stamp = `${String(process.pid)}-${randomBytes(4).toString('hex')}`;
  const body = `${options.out}.${stamp}.body.tmp`;
  const whole = `${options.out}.${stamp}.tmp`;
  const files: ManifestFile[] = [];
  try {
    await pipeline(
      tarEntries(plan, files, options),
      createGzip(),
      createWriteStream(body, { mode: 0o600, flags: 'wx' }),
    );
    const { site } = plan;
    const manifest: ExportManifest = {
      format: site.format,
      cms: site.cms,
      exportedAt: now.toISOString(),
      baseUrl: site.baseUrl,
      content: site.content,
      credentials: site.credentials,
      devMode: site.devMode,
      files,
      undeclared: site.undeclared,
      notCarried: site.notCarried,
      credentialsLeftOut: site.credentialsLeftOut,
      plugins: site.plugins,
      overrides: site.overrides,
      pending: site.pending,
    };
    const text = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const head = gzipSync(
      Buffer.concat([
        tarHeader({ name: MANIFEST_NAME, mode: 0o600, size: text.length, mtime: now }),
        text,
        tarPadding(text.length),
      ]),
    );
    await pipeline(
      async function* () {
        yield head;
        yield* createReadStream(body);
      },
      createWriteStream(whole, { mode: 0o600, flags: 'wx' }),
    );
    await chmod(whole, 0o600);
    await rename(whole, options.out);
    return manifest;
  } finally {
    await rm(body, { force: true });
    await rm(whole, { force: true });
  }
}
