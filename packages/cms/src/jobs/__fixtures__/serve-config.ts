/**
 * The config of the site cli-jobs.test.ts serves: one job that logs each run
 * to `$GEEKITY_TEST_JOB_DIR/runs.log` and waits until `release` appears
 * there, or until its signal is aborted.
 */
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { JobDefinition } from '../types.ts';

const directory = process.env.GEEKITY_TEST_JOB_DIR ?? '';
const log = (line: string) => {
  appendFileSync(path.join(directory, 'runs.log'), `${line} ${String(process.pid)}\n`);
};

const waitForRelease: JobDefinition<null, string> = {
  name: 'wait-for-release',
  parse: () => null,
  async run(_payload, context) {
    log(`start ${String(context.attempt)}`);
    while (!existsSync(path.join(directory, 'release'))) {
      if (context.signal.aborted) {
        log(`aborted ${String(context.attempt)}`);
        throw new Error('The queue stopped.');
      }
      await delay(20);
    }
    log(`done ${String(context.attempt)}`);
    return 'released';
  },
};

export default { jobs: { definitions: [waitForRelease] } };
