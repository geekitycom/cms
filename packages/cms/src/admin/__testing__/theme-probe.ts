import { readFile } from 'node:fs/promises';

import { findUser, usersFile } from '../accounts.ts';
import { ADMIN_SECTIONS } from '../menu.ts';
import { browser, csrfField, FIRST_ADMIN, sandbox, signedIn } from './harness.ts';

/**
 * Run in a child process by `admin-theme.test.ts` with `GEEKITY_ADMIN=daisyui`,
 * since the switch is read once when the admin's modules load. Walks one user
 * through choosing a theme and going back to the system's, and prints what the
 * admin served and stored at each step, as JSON, for the test to judge.
 */
const box = sandbox();
try {
  const cms = await box.site();
  const setup = await (await browser(cms).get('/admin/setup')).text();
  const agent = await signedIn(cms);
  const id = findUser(cms.config.dataDir, FIRST_ADMIN.username)?.id ?? 0;
  const editUrl = `/admin/users/${String(id)}`;

  async function stored(): Promise<unknown> {
    const file = JSON.parse(await readFile(usersFile(cms.config.dataDir), 'utf8')) as {
      users: Record<string, unknown>[];
    };
    return file.users.find((user) => user['id'] === id)?.['adminTheme'] ?? null;
  }

  async function page(url: string): Promise<string> {
    return await (await agent.get(url)).text();
  }

  async function choose(theme: string): Promise<number> {
    const token = csrfField(await page(editUrl)) ?? '';
    return (await agent.post('/admin/users/theme', { csrf_token: token, admin_theme: theme }))
      .status;
  }

  const edit = await page(editUrl);
  await agent.post('/admin/users/new', {
    csrf_token: csrfField(edit) ?? '',
    username: 'grace',
    password: 'another horse battery staple',
  });
  const grace = findUser(cms.config.dataDir, 'grace')?.id ?? 0;
  const someoneElse = await page(`/admin/users/${String(grace)}`);
  const storedBefore = await stored();

  const choseDracula = await choose('dracula');
  const storedDracula = await stored();
  const screens: Record<string, string> = { [editUrl]: await page(editUrl) };
  for (const section of ADMIN_SECTIONS) {
    for (const child of section.children) screens[child.url] = await page(child.url);
  }
  const account = {
    login: await page('/admin/login'),
    forgot: await page('/admin/forgot'),
    reset: await page('/admin/reset'),
  };
  const stylesheet = await page('/admin/_static/admin.css');

  const choseUnknown = await choose('solarized');
  const storedAfterUnknown = await stored();

  const choseSystem = await choose('');
  const storedSystem = await stored();
  const dashboardSystem = await page('/admin');

  process.stdout.write(
    JSON.stringify({
      setup,
      edit,
      editUrl,
      someoneElse,
      storedBefore,
      choseDracula,
      storedDracula,
      screens,
      account,
      stylesheet,
      choseUnknown,
      storedAfterUnknown,
      choseSystem,
      storedSystem,
      dashboardSystem,
    }),
  );
} finally {
  await box.cleanup();
}
