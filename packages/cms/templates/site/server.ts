import { createCms } from '@geekity/cms';

import config from './geekity.config.ts';

const cms = createCms(config);

// Routes of your own go here. They are registered before the CMS resolves a
// path against the content index, so a route always wins over a permalink that
// would collide with it. Delete this one once you have your own.
cms.app.get('/hello/', (c) => c.text('a route of my own'));

const { port } = await cms.serve();

console.log(`listening on http://localhost:${String(port)}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cms.close().then(() => process.exit(0));
  });
}
