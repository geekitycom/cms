import { mkdir } from 'node:fs/promises';

import { EXPORTS, dataPath } from '../files/data-files.ts';
import { jobName } from '../jobs/types.ts';
import type { JobDefinition } from '../jobs/types.ts';
import type { Clock } from '../util/clock.ts';
import { clearUnfinishedExports, keepOnlyExport } from '../files/export-archives.ts';
import {
  SITE_EXPORT_JOB_NAME,
  exportFileName,
  planSiteExport,
  writeSiteExport,
} from './site-export.ts';
import type { ExportProgress, SiteExportSource } from './site-export.ts';

/** No password and no secret: `jobs.json` is exported. */
export type SiteExportPayload = { readonly withCredentials: boolean };

export type SiteExportResult = {
  readonly file: string;
  readonly files: number;
  readonly bytes: number;
  readonly credentials: boolean;
  readonly credentialsLeftOut: readonly string[];
  readonly undeclared: readonly string[];
  readonly deliveries: number;
};

export const SITE_EXPORT_JOB = jobName<SiteExportPayload, SiteExportResult>(SITE_EXPORT_JOB_NAME);

const PROGRESS_STEPS = 100;

export function sizeLabel(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const shown = unit === 0 ? String(value) : String(Number(value.toFixed(1)));
  return `${shown} ${units[unit] ?? 'bytes'}`;
}

export function siteExportJob(
  source: SiteExportSource,
  now: Clock,
): JobDefinition<SiteExportPayload, SiteExportResult> {
  const { dataDir, baseUrl } = source.config;
  return {
    name: SITE_EXPORT_JOB.name,
    parse(payload) {
      const withCredentials =
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? (payload as { withCredentials?: unknown }).withCredentials
          : undefined;
      if (typeof withCredentials !== 'boolean') {
        throw new Error('A site export job needs withCredentials, true or false.');
      }
      return { withCredentials };
    },
    async run({ withCredentials }, context) {
      await clearUnfinishedExports(dataDir);
      await mkdir(dataPath(dataDir, EXPORTS), { recursive: true });
      const plan = await planSiteExport(source, { withCredentials, withContent: true });
      const started = now();
      const file = exportFileName(baseUrl, started);
      const step = Math.max(1, Math.floor(plan.files.length / PROGRESS_STEPS));
      const manifest = await writeSiteExport(plan, {
        out: dataPath(dataDir, EXPORTS, file),
        now: started,
        signal: context.signal,
        progress: (progress: ExportProgress) =>
          progress.files % step === 0 || progress.files === progress.totalFiles
            ? context.progress({
                done: progress.files,
                total: progress.totalFiles,
                note: `${sizeLabel(progress.bytes)} of ${sizeLabel(progress.totalBytes)}.`,
              })
            : undefined,
      });
      await keepOnlyExport(dataDir, file);
      return {
        file,
        files: manifest.files.length,
        bytes: manifest.files.reduce((total, each) => total + each.size, 0),
        credentials: manifest.credentials,
        credentialsLeftOut: manifest.credentialsLeftOut,
        undeclared: manifest.undeclared,
        deliveries: manifest.pending.deliveries,
      };
    },
  };
}
