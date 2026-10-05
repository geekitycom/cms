import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { findUser, setUserAdminTheme } from '../accounts.ts';
import type { AdminTheme } from '../admin-theme.ts';
import { FIRST_ADMIN, sandbox, signedIn } from './harness.ts';

/**
 * Run in a child process by `daisyui-bar.test.ts` with `GEEKITY_ADMIN=daisyui`,
 * since the switch is read once when the admin's modules load. Draws the bar
 * on an admin screen and on a public page for one user in each of three theme
 * choices, and prints what was served, as JSON, for the test to judge.
 */
const box = sandbox();
try {
  const contentDir = await box.dir('geekity-bar-probe-content-');
  const post = path.join(contentDir, 'posts', '2026-01-02-published.md');
  await mkdir(path.dirname(post), { recursive: true });
  await writeFile(
    post,
    '---\ntitle: Published\ndate: 2026-01-02T09:00:00Z\npermalink: /2026/01/published/\n---\n\nBody.\n',
  );

  const cms = await box.site({ contentDir });
  const agent = await signedIn(cms);
  const userId = findUser(cms.config.dataDir, FIRST_ADMIN.username)?.id ?? 0;

  const choices: Record<string, AdminTheme | undefined> = {
    system: undefined,
    dracula: 'dracula',
    cupcake: 'cupcake',
  };
  const drawn: Record<string, { admin: string; csp: string; public: string }> = {};
  for (const [choice, theme] of Object.entries(choices)) {
    await setUserAdminTheme({ dataDir: cms.config.dataDir, userId, theme });
    const admin = await agent.get('/admin');
    drawn[choice] = {
      admin: await admin.text(),
      csp: admin.headers.get('content-security-policy') ?? '',
      public: await (await agent.get('/2026/01/published/')).text(),
    };
  }

  const editor = await (await agent.get('/admin/posts/published')).text();
  const script = await cms.app.request('/admin/_static/admin-bar.js');

  process.stdout.write(
    JSON.stringify({
      drawn,
      editor,
      script: {
        status: script.status,
        type: script.headers.get('content-type') ?? '',
        body: await script.text(),
      },
    }),
  );
} finally {
  await box.cleanup();
}
