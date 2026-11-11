import { setTimeout as delay } from 'node:timers/promises';

import { updateFileAtomically } from '../atomic.ts';

const [file = '', prefix = '', times = '1'] = process.argv.slice(2);

for (let time = 0; time < Number(times); time += 1) {
  await updateFileAtomically(file, async (current) => {
    const data = JSON.parse(current ?? '{}') as Record<string, boolean>;
    await delay(5);
    data[`${prefix}${String(time)}`] = true;
    return JSON.stringify(data);
  });
}
