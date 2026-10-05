import { sandbox } from './harness.ts';
import { remainingScreens } from './remaining-screens.ts';

/**
 * Run in a child process by `remaining-screens.test.ts` with
 * `GEEKITY_ADMIN=daisyui`, since the switch is read once when the admin's
 * modules load. Prints every remaining screen over one seeded site, as JSON by
 * screen name.
 */
const box = sandbox();
try {
  process.stdout.write(JSON.stringify(await remainingScreens(box)));
} finally {
  await box.cleanup();
}
