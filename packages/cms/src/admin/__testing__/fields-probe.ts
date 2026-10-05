import { findUser } from '../accounts.ts';
import { SETTINGS_PAGE_FORMS, settingsPageUrl } from './settings.ts';
import { browser, csrfField, FIRST_ADMIN, sandbox, signedIn } from './harness.ts';

/**
 * Run in a child process by `form-errors.test.ts` with `GEEKITY_ADMIN=daisyui`,
 * since the switch is read once when the admin's modules load. Refuses a login,
 * a settings save and an add-user form, reads every settings page, the users
 * screens with fields and the login screen, and prints what the admin served, as JSON,
 * for the test to judge.
 */
const box = sandbox();
try {
  const cms = await box.site();
  const agent = await signedIn(cms);
  const guest = browser(cms);
  const you = `/admin/users/${String(findUser(cms.config.dataDir, FIRST_ADMIN.username)?.id ?? 0)}`;

  async function page(url: string, as = agent): Promise<string> {
    return await (await as.get(url)).text();
  }

  async function refuse(
    url: string,
    form: Record<string, string>,
    as = agent,
  ): Promise<{ status: number; html: string }> {
    const token = csrfField(await page(url, as)) ?? '';
    const response = await as.post(url, { csrf_token: token, ...form });
    return { status: response.status, html: await response.text() };
  }

  const refused = {
    login: await refuse(
      '/admin/login',
      { username: FIRST_ADMIN.username, password: 'not the password' },
      guest,
    ),
    settings: await refuse('/admin/settings', {
      ...SETTINGS_PAGE_FORMS['general'],
      title: '',
      timezone: 'Nowhere/Special',
    }),
    addUser: await refuse('/admin/users/new', { username: '', password: 'short' }),
  };

  const screens: Record<string, string> = {};
  for (const name of Object.keys(SETTINGS_PAGE_FORMS)) {
    const url = settingsPageUrl(name);
    screens[url] = await page(url);
  }
  for (const url of [you, '/admin/users/new', '/admin/users/apps']) {
    screens[url] = await page(url);
  }
  screens['/admin/login'] = await page('/admin/login', guest);

  process.stdout.write(JSON.stringify({ refused, screens }));
} finally {
  await box.cleanup();
}
