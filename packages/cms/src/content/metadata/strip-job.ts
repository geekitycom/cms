import path from 'node:path';

import type { JobDefinition, Json } from '../../jobs/types.ts';
import { UPLOAD_DIRECTORY } from '../uploads.ts';
import { stripStoredUploads } from './sweep.ts';

export const STRIP_METADATA_JOB = 'strip-metadata';

/** What one sweep of `content/uploads/` did, as its job's result. */
export type StripReport = {
  /** How many files of a type that can carry metadata were looked at. */
  readonly checked: number;
  readonly stripped: readonly { readonly path: string; readonly removed: readonly string[] }[];
  readonly clean: number;
  readonly unreadable: readonly { readonly path: string; readonly problem: string }[];
};

/**
 * The sweep as a job (TASK-392): the admin's button and `geekity
 * strip-metadata` both queue it. It takes no payload, stops before the next
 * file once its signal is aborted, and is safe to run again.
 */
export function stripMetadataJob(contentDir: string): JobDefinition<null, StripReport> {
  return {
    name: STRIP_METADATA_JOB,
    parse: () => null,
    async run(_payload, context) {
      const swept = await stripStoredUploads(path.join(contentDir, UPLOAD_DIRECTORY), {
        signal: context.signal,
        progress: (done, total) => context.progress({ done, total }),
      });
      return {
        checked: swept.length,
        stripped: swept.flatMap((file) =>
          file.outcome === 'stripped' ? [{ path: file.path, removed: file.removed }] : [],
        ),
        clean: swept.filter((file) => file.outcome === 'clean').length,
        unreadable: swept.flatMap((file) =>
          file.outcome === 'unreadable' ? [{ path: file.path, problem: file.problem }] : [],
        ),
      };
    },
  };
}

/** A finished sweep's result read back from its job record, or `undefined` when it is not one. */
export function stripReport(result: Json): StripReport | undefined {
  if (!isRecord(result)) return undefined;
  const { checked, stripped, clean, unreadable } = result;
  if (typeof checked !== 'number' || typeof clean !== 'number') return undefined;
  if (!Array.isArray(stripped) || !Array.isArray(unreadable)) return undefined;
  const files = (list: readonly Json[], field: string) =>
    list.every((file) => isRecord(file) && typeof file['path'] === 'string' && field in file);
  if (!files(stripped, 'removed') || !files(unreadable, 'problem')) return undefined;
  return result as StripReport;
}

function isRecord(value: Json): value is { readonly [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
