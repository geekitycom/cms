import { jobName } from '../jobs/types.ts';
import type { JobDefinition, JobQueue } from '../jobs/types.ts';
import { isRecord } from '../util/guards.ts';
import { canonicalStyles } from './family.ts';
import type { FontStyle } from './family.ts';
import type { FontStore } from './store.ts';

export type FontFetchPayload = {
  readonly family: string;
  readonly styles: readonly FontStyle[];
};

export type FontFetchResult = {
  readonly family: string;
  readonly href: string;
  readonly fetched: boolean;
};

export const FONT_FETCH_JOB = jobName<FontFetchPayload, FontFetchResult>('fetch-font');

export function fontFetchJob(fonts: FontStore): JobDefinition<FontFetchPayload, FontFetchResult> {
  return {
    name: FONT_FETCH_JOB.name,
    parse(payload) {
      const family = isRecord(payload) ? payload['family'] : undefined;
      const styles = isRecord(payload) ? payload['styles'] : undefined;
      if (typeof family !== 'string' || !Array.isArray(styles)) {
        throw new Error('A font fetch job needs a family and its styles.');
      }
      return {
        family,
        styles: styles.map((style) => {
          const weight = isRecord(style) ? style['weight'] : undefined;
          const italic = isRecord(style) ? style['italic'] : undefined;
          if (typeof weight !== 'number' || typeof italic !== 'boolean') {
            throw new Error('A font style is a weight and whether it is italic.');
          }
          return { weight, italic };
        }),
      };
    },
    async run({ family, styles }, context) {
      const fetched = await fonts.ensure(family, styles, context.signal);
      if (!fetched.ok) throw new Error(fetched.refusal.message);
      return {
        family: fetched.stylesheet.family,
        href: fetched.stylesheet.href,
        fetched: fetched.fetched,
      };
    },
  };
}

/**
 * Queue a fetch of the family in these styles, unless one for the same family
 * and styles is already queued or running. Resolves with the job's id.
 */
export async function queueFontFetch(
  jobs: JobQueue,
  family: string,
  styles: readonly FontStyle[],
): Promise<string> {
  const payload: FontFetchPayload = { family, styles: canonicalStyles(styles) };
  const same = JSON.stringify(payload);
  const active = await jobs.list(['queued', 'running']);
  const waiting = active.find(
    (job) => job.name === FONT_FETCH_JOB.name && JSON.stringify(job.payload) === same,
  );
  return waiting?.id ?? (await jobs.enqueue(FONT_FETCH_JOB, payload));
}
