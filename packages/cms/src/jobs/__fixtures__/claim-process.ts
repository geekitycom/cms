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
