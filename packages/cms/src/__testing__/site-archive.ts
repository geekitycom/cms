import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { EXPORT_FORMAT, MANIFEST_NAME } from '../export/site-export.ts';
import type { ExportManifest, ExportedClass, ManifestFile } from '../export/site-export.ts';
import { TAR_END, tarHeader, tarPadding } from '../files/tar.ts';

/**
 * A site archive built by hand, as `geekity export` lays one out, so a test of
 * `geekity import` can name every byte, including the ones a damaged or
 * hostile archive would hold.
 */

export interface ArchivedEntry {
  readonly name: string;
  readonly body?: string;
  readonly mode?: number;
  /** The tar type flag: `0` a file, `2` a link, `5` a folder. */
  readonly type?: '0' | '2' | '5';
  readonly class?: ExportedClass;
  /** Whether the manifest lists it. Files are listed unless this says no. */
  readonly listed?: boolean;
  /** The hash the manifest claims, when a test wants it to lie. */
  readonly sha256?: string;
}

export const ARCHIVE_BASE_URL = 'https://blog.example';

export function siteManifest(overrides: Partial<ExportManifest> = {}): ExportManifest {
  return {
    format: EXPORT_FORMAT,
    cms: '0.31.0',
    exportedAt: '2026-10-14T15:00:00.000Z',
    baseUrl: ARCHIVE_BASE_URL,
    content: true,
    credentials: false,
    devMode: false,
    files: [],
    undeclared: [],
    notCarried: [],
    credentialsLeftOut: [],
    plugins: [],
    overrides: [],
    pending: { deliveries: 0, jobs: { queued: 0, running: 0 } },
    ...overrides,
  };
}

function entryBlocks(entry: ArchivedEntry): Buffer {
  const body = Buffer.from(entry.body ?? '');
  const header = tarHeader({
    name: entry.name,
    mode: entry.mode ?? 0o644,
    size: body.length,
    mtime: new Date('2026-10-14T15:00:00Z'),
  });
  const type = entry.type ?? '0';
  if (type !== '0') {
    const block = header.subarray(header.length - 512);
    block.write(type, 156, 'ascii');
    block.write(' '.repeat(8), 148, 'ascii');
    const sum = block.reduce((total, byte) => total + byte, 0);
    block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  }
  return Buffer.concat([header, body, tarPadding(body.length)]);
}

/** The manifest's record of each file entry it lists. */
export function manifestFiles(entries: readonly ArchivedEntry[]): ManifestFile[] {
  return entries
    .filter((entry) => (entry.type ?? '0') === '0' && entry.listed !== false)
    .map((entry) => {
      const body = Buffer.from(entry.body ?? '');
      return {
        path: entry.name,
        class: entry.class ?? 'kept',
        size: body.length,
        sha256: entry.sha256 ?? createHash('sha256').update(body).digest('hex'),
      };
    });
}

/** `manifest.json` and then each entry, the manifest listing every file entry with its real hash. */
export function siteArchive(
  entries: readonly ArchivedEntry[],
  manifest: Partial<ExportManifest> = {},
): Buffer {
  const text = JSON.stringify(siteManifest({ files: manifestFiles(entries), ...manifest }));
  return gzipSync(
    Buffer.concat([
      entryBlocks({ name: MANIFEST_NAME, body: text, mode: 0o600 }),
      ...entries.map(entryBlocks),
      TAR_END,
    ]),
  );
}

/** The files of a small site whose `site.json` names the archive's base URL. */
export function siteFiles(): ArchivedEntry[] {
  return [
    {
      name: 'content/_data/site.json',
      body: `${JSON.stringify({ title: 'Blog', url: ARCHIVE_BASE_URL })}\n`,
    },
    { name: 'content/posts/2026-01-01-one.md', body: '---\ntitle: One\n---\n\nOne.\n' },
    { name: 'data/users.json', body: '{"users":[],"nextId":1}\n', mode: 0o600 },
    { name: 'data/notification-secret', body: 'secret', mode: 0o600 },
  ];
}
