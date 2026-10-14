import { appendFileSync } from 'node:fs';

import { withLockFile } from '../lock-file.ts';

const [lock = '', log = '', times = '1'] = process.argv.slice(2);

for (let time = 0; time < Number(times); time += 1) {
  await withLockFile(lock, async () => {
    appendFileSync(log, `enter ${String(process.pid)}\n`);
    for (let turn = 0; turn < 50; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    appendFileSync(log, `leave ${String(process.pid)}\n`);
  });
}
