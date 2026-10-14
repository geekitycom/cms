import { appendFileSync } from 'node:fs';

import { systemClock } from '../../util/clock.ts';
import { createFileRecords } from '../file-records.ts';
import { createInProcessTransport } from '../in-process.ts';
import { createJobQueue } from '../queue.ts';
import type { JobDefinition } from '../types.ts';

const [file = '', command = '', prefix = '', count = '', log = ''] = process.argv.slice(2);
const ids = Array.from({ length: Number(count) }, (_, index) => `${prefix}-${String(index)}`);
const records = createFileRecords(file, { keep: 1000 });

const race = (id: string) =>
  ({
    id,
    name: 'race',
    payload: null,
    queuedAt: '2026-10-14T00:00:00.000Z',
    state: 'queued',
    attempt: 1,
  }) as const;

switch (command) {
  case 'create':
    await Promise.all(ids.map((id) => records.create(race(id))));
    break;
  case 'create-unless-queued':
    await Promise.all(
      ids.map((id) => records.create(race(id), (latest) => latest.state === 'queued')),
    );
    break;
  case 'run': {
    const logged: JobDefinition<string, number> = {
      name: 'logged',
      parse: String,
      run(id) {
        appendFileSync(log, `${id} ${String(process.pid)}\n`);
        return Promise.resolve(process.pid);
      },
    };
    const queue = createJobQueue({
      transport: createInProcessTransport(),
      records,
      jobs: [logged],
      now: systemClock,
    });
    const states = await Promise.all(ids.map(async (id) => (await queue.run(id)).state));
    process.stdout.write(states.join('\n'));
    break;
  }
  default:
    throw new Error(`Unknown command ${command}`);
}
