/**
 * A CLI process running one job beside `geekity serve`, for cli-jobs.test.ts:
 * it runs the job of serve-config.ts by id, as `geekity strip-metadata` runs
 * its own, and prints the state and attempt it ended at.
 *
 *   claim-process.ts <jobs.json> <job id>
 */
import { systemClock } from '../../util/clock.ts';
import { createFileRecords } from '../file-records.ts';
import { createInProcessTransport } from '../in-process.ts';
import { createJobQueue } from '../queue.ts';
import config from './serve-config.ts';

const [file = '', id = ''] = process.argv.slice(2);

const queue = createJobQueue({
  transport: createInProcessTransport(),
  records: createFileRecords(file),
  jobs: config.jobs.definitions,
  now: systemClock,
});
const status = await queue.run(id);
process.stdout.write(`${status.state} ${String(status.attempt)}`);
