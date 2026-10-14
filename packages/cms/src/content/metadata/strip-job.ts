import path from 'node:path';

import { jobName } from '../../jobs/types.ts';
import type { JobDefinition } from '../../jobs/types.ts';
import { UPLOAD_DIRECTORY } from '../uploads.ts';
import { stripStoredUploads } from './sweep.ts';

export type StripReport = {
  readonly checked: number;
  readonly stripped: readonly { readonly path: string; readonly removed: readonly string[] }[];
  readonly clean: number;
  readonly unreadable: readonly { readonly path: string; readonly problem: string }[];
};

export const STRIP_METADATA_JOB = jobName<null, StripReport>('strip-metadata');

export function stripMetadataJob(contentDir: string): JobDefinition<null, StripReport> {
  return {
    name: STRIP_METADATA_JOB.name,
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
