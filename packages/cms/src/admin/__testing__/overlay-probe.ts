import { FEDERATION_PATH } from '../federation.ts';
import { sandbox, signedIn } from './harness.ts';

/**
 * Run in a child process by `daisyui.test.ts` with `GEEKITY_ADMIN` set, since
 * the switch is read once when the admin's modules load. Prints what the admin
 * served, as JSON, for the test to judge.
 */
const box = sandbox();
try {
  const cms = await box.site();
  const agent = await signedIn(cms);
  const unconverted = await (await agent.get(FEDERATION_PATH)).text();
  const login = await (await cms.app.request('/admin/login')).text();
  const stylesheet = await cms.app.request('/admin/_static/admin.css');
  const editor = await cms.app.request('/admin/_static/editor.js');

  process.stdout.write(
    JSON.stringify({
      login,
      unconverted,
      stylesheet: { status: stylesheet.status, body: await stylesheet.text() },
      editor: { status: editor.status, body: await editor.text() },
    }),
  );
} finally {
  await box.cleanup();
}
