import { networkInterfaces } from 'node:os';

import { createCms } from '@geekity/cms';

import config from './geekity.config.ts';

const cms = createCms(config);
const { port } = await cms.serve();

console.log(`demo site listening on http://localhost:${String(port)}`);
for (const address of networkAddresses()) {
  console.log(`  and on your network at http://${address}:${String(port)}`);
}
if (process.env['GEEKITY_BASE_URL'] === undefined) {
  console.log(
    `  (feeds, IndieAuth and Micropub links say ${config.baseUrl ?? 'localhost'}; set GEEKITY_BASE_URL to a network address to test those from another device)`,
  );
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cms.close().then(() => process.exit(0));
  });
}

function networkAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}
