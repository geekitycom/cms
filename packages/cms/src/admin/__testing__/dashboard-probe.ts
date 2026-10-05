import { sandbox, signedIn } from './harness.ts';

/**
 * Run in a child process by `dashboard.test.ts` with `GEEKITY_ADMIN=daisyui`,
 * since the switch is read once when the admin's modules load. Boots a site
 * over each content directory named on the command line, signs in, and prints
 * the dashboard each one served, in the same order, as JSON.
 */
const box = sandbox();
try {
  const dashboards: string[] = [];
  for (const contentDir of process.argv.slice(2)) {
    const agent = await signedIn(await box.site({ contentDir }));
    dashboards.push(await (await agent.get('/admin')).text());
  }
  process.stdout.write(JSON.stringify(dashboards));
} finally {
  await box.cleanup();
}
