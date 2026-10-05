import { MAIL_TEST_FIELDS, MAIL_TEST_PATH } from '../settings-email.ts';
import { RESET_PATH } from '../recovery.ts';
import { browser, csrfField, sandbox, signedIn } from './harness.ts';
import { saveSettings, SETTINGS_PAGE_FORMS, settingsPageUrl } from './settings.ts';

/**
 * Run in a child process by `shell.test.ts` with `GEEKITY_ADMIN=daisyui`,
 * since the switch is read once when the admin's modules load. Reads the four
 * account screens, saves every settings page and follows each save to the page
 * that shows its flash, refuses a test email for an error flash, and prints
 * what the admin served, as JSON, for the test to judge.
 */
const box = sandbox();
try {
  const cms = await box.site();
  const guest = browser(cms);

  async function page(url: string, as = guest): Promise<string> {
    return await (await as.get(url)).text();
  }

  const setup = await page('/admin/setup');
  const agent = await signedIn(cms);
  const account = {
    setup,
    login: await page('/admin/login'),
    forgot: await page('/admin/forgot'),
    reset: await page(`${RESET_PATH}?token=${'0'.repeat(64)}`),
  };

  const saves: Record<string, { status: number; location: string; url: string; html: string }> = {};
  for (const name of Object.keys(SETTINGS_PAGE_FORMS)) {
    const response = await saveSettings(agent, name);
    const location = response.headers.get('location') ?? '';
    saves[name] = {
      status: response.status,
      location,
      url: settingsPageUrl(name),
      html: await page(location, agent),
    };
  }

  const email = settingsPageUrl('email');
  await agent.post(MAIL_TEST_PATH, {
    csrf_token: csrfField(await page(email, agent)) ?? '',
    [MAIL_TEST_FIELDS.to]: '',
  });
  const refusedTest = await page(email, agent);

  process.stdout.write(JSON.stringify({ account, saves, refusedTest }));
} finally {
  await box.cleanup();
}
