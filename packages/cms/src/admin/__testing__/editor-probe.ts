import { editorScreens } from './editor-screens.ts';
import { sandbox } from './harness.ts';

/**
 * Run in a child process by `editor-daisyui.test.ts` with `GEEKITY_ADMIN=daisyui`,
 * since the switch is read once when the admin's modules load. Prints every
 * editor screen over one seeded site, as JSON by screen name.
 */
const box = sandbox();
try {
  process.stdout.write(JSON.stringify(await editorScreens(box)));
} finally {
  await box.cleanup();
}
