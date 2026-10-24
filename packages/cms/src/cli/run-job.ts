import type { ResolvedConfig } from '../config.ts';
import type { Cms } from '../index.ts';
import { finishedResult } from '../jobs/types.ts';
import type { JobName, Json } from '../jobs/types.ts';
import { isServing } from '../supervisor/control.ts';

/**
 * Run one job in this process and return its result, or say on standard
 * error why there is none. A job of the same name that is already active
 * stops it before it is queued. A queued job counts only while a server is up
 * to run it: one a command left queued when it died runs when a server next
 * starts, and is no reason to refuse while none is.
 */
export async function runJobHere<P extends Json, R extends Json>(
  config: ResolvedConfig,
  job: JobName<P, R>,
  payload: NoInfer<P>,
  what: string,
  prepare?: (cms: Cms) => Promise<unknown>,
): Promise<R | undefined> {
  const { createCms } = await import('../index.ts');
  const cms = createCms(config);
  let status;
  try {
    await prepare?.(cms);
    const enqueued = await cms.jobs.enqueueUnlessActive(job, payload, {
      countQueued: await isServing(config.dataDir),
    });
    if (!enqueued.queued) {
      process.stderr.write(
        `A ${job.name} job is already ${enqueued.active.state}, so this one did not start. ` +
          `Run the command again once it finishes.\n`,
      );
      return undefined;
    }
    status = await cms.jobs.run(enqueued.id);
  } finally {
    await cms.close();
  }

  const result = finishedResult(job, status);
  if (result === undefined) {
    const problem = status.state === 'failed' ? status.error : `The job ended ${status.state}.`;
    process.stderr.write(`The ${what} did not finish: ${problem}\n`);
  }
  return result;
}
