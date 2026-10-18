import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
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

const startedHere = () =>
  existsSync(path.join(directory, 'runs.log')) &&
  readFileSync(path.join(directory, 'runs.log'), 'utf8')
    .split('\n')
    .some((line) => line.startsWith('start ') && line.endsWith(` ${String(process.pid)}`));

const failBoot = {
  name: '@test/plugin-fail-boot',
  version: '1.0.0',
  label: 'Fail boot',
  description: 'Fails a server boot after the server has started the job.',
  hostApi: 2,
  register: () => undefined,
  async start() {
    const marker = path.join(directory, 'fail-boot');
    if (!existsSync(marker)) return;
    while (!startedHere()) await delay(20);
    // Only the boot the test asked to fail: the old worker restarts its
    // plugins when it resumes, and a start that never ends would hold its
    // shutdown until the supervisor gives up and kills it.
    rmSync(marker);
    process.send?.({ type: 'boot-failed', error: 'The test failed this boot.' });
    await new Promise<never>(() => undefined);
  },
};

export default { jobs: { definitions: [waitForRelease] }, plugins: [failBoot] };
