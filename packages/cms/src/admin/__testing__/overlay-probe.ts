import { THEMES_PATH } from '../appearance.ts';
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
  const unconverted = await (await agent.get(THEMES_PATH)).text();
  const login = await (await cms.app.request('/admin/login')).text();
  const stylesheet = await cms.app.request('/admin/_static/admin.css');
  const editor = await cms.app.request('/admin/_static/editor.js');
  const slug = await cms.app.request('/admin/_static/slug.js');

  process.stdout.write(
    JSON.stringify({
      login,
      unconverted,
      stylesheet: { status: stylesheet.status, body: await stylesheet.text() },
      editor: { status: editor.status, body: await editor.text() },
      slug: { status: slug.status, body: await slug.text() },
    }),
  );
} finally {
  await box.cleanup();
}
