import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { tiedErrors } from '../__testing__/form-errors.ts';
import {
  browser,
  csrfField,
  FIRST_ADMIN,
  sandbox,
  setUpFirstAdmin,
  signedIn,
} from './__testing__/harness.ts';
import { createAdminTemplateEnvironment, PACKAGED_ADMIN_DIR } from './templates.ts';

/**
 * Every admin form built from `components/fields.njk`, refused (TASK-142).
 *
 * The screens are found by reading the templates rather than from a list, so
 * a form added later is held to the same contract without anybody
 * remembering to add it here: rendered with a problem on every field it could
 * fault, it has one summary that takes focus, and every field the summary
 * links to is marked invalid and names its message.
 */

const environment = createAdminTemplateEnvironment({ noCache: true });

/** A problem for whatever key a template asks after. */
const everyProblem: Record<string, string> = new Proxy(
  {},
  { get: (_target, key) => (typeof key === 'string' ? `Wrong ${key}.` : undefined) },
);

/** The submitted name of whatever field a template asks after. */
const everyField: Record<string, string> = new Proxy(
  {},
  { get: (_target, key) => (typeof key === 'string' ? key : undefined) },
);

/** What a screen is handed when the form on it was refused, every way it can be. */
const refused = {
  fields: everyField,
  csrfToken: 'token',
  hasProblems: true,
  configured: true,
  problems: everyProblem,
  addProblems: everyProblem,
  problem: 'Wrong problem.',
  nameProblem: 'Wrong name.',
  error: 'Wrong error.',
  areas: [{ name: 'primary', label: 'Primary', items: '', problem: 'Wrong items.' }],
  others: [],
  account: { id: 'one', username: 'ada', you: true, profile: {}, notifications: [] },
};

/**
 * The screens that hold more than one form, each refused on its own: only one
 * of them is ever submitted at a time.
 */
const SEPARATELY: Readonly<Record<string, readonly Record<string, unknown>[]>> = {
  'pages/users/edit.njk': [{ profileProblems: everyProblem }, { passwordProblems: everyProblem }],
};

async function templatesUsingFields(): Promise<string[]> {
  const pages = path.join(PACKAGED_ADMIN_DIR, 'pages');
  const found: string[] = [];
  for (const entry of await readdir(pages, { recursive: true })) {
    if (!entry.endsWith('.njk')) continue;
    const source = await readFile(path.join(pages, entry), 'utf8');
    if (source.includes('"components/fields.njk"')) found.push(`pages/${entry}`);
  }
  return found.sort();
}

describe('every admin form built from the field macros, refused', async () => {
  const templates = await templatesUsingFields();

  it('is found by reading the templates', () => {
    assert.ok(templates.length >= 14, `the macro's screens were found: ${templates.join(', ')}`);
  });

  for (const template of templates) {
    for (const variant of SEPARATELY[template] ?? [{}]) {
      it(`${template} ties each error to its field and leads with a summary ${JSON.stringify(Object.keys(variant))}`, () => {
        const html = environment.render(template, { ...refused, ...variant });

        const { heading, links } = tiedErrors(html);
        const fieldErrors = html.match(/class="admin-field-error" id=/g)?.length ?? 0;
        assert.equal(links.length, fieldErrors, 'every field error is in the summary');
        if (links.length === 0) {
          assert.equal(heading, 'Wrong error.', 'a form-level error heads its own summary');
        }
      });
    }
  }
});

describe('a refused request, over HTTP', () => {
  const box = sandbox();
  after(() => box.cleanup());

  it('announces a failed login and moves focus to it', async () => {
    const cms = await box.site();
    await setUpFirstAdmin(browser(cms));
    const agent = browser(cms);
    const token = csrfField(await (await agent.get('/admin/login')).text()) ?? '';

    const response = await agent.post('/admin/login', {
      csrf_token: token,
      username: FIRST_ADMIN.username,
      password: 'not the password',
    });

    assert.equal(response.status, 401);
    const { heading } = tiedErrors(await response.text());
    assert.equal(heading, 'That username and password do not match.');
  });

  it('links a refused settings save to the field it refused', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const token = csrfField(await (await agent.get('/admin/settings')).text()) ?? '';

    const response = await agent.post('/admin/settings', {
      csrf_token: token,
      title: '',
      base_url: 'https://example.org',
      timezone: 'Nowhere/Special',
      language: 'en',
    });

    assert.equal(response.status, 400);
    const { links } = tiedErrors(await response.text());
    assert.deepEqual(links, ['settings-title', 'settings-timezone']);
  });
});
