import { sandbox } from './harness.ts';
import { listScreens } from './list-screens.ts';

/**
 * Run in a child process by `list-screens.test.ts` with `GEEKITY_ADMIN=daisyui`,
 * since the switch is read once when the admin's modules load. Prints every
 * list screen over one seeded site, as JSON by screen name.
 */
const box = sandbox();
try {
  process.stdout.write(JSON.stringify(await listScreens(box)));
} finally {
  await box.cleanup();
}
