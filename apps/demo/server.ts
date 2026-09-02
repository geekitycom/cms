import { createCms } from '@geekity/cms';

import config from './geekity.config.ts';

const cms = createCms(config);
const { port } = await cms.serve();

console.log(`demo site listening on http://localhost:${String(port)}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cms.close().then(() => process.exit(0));
  });
}
