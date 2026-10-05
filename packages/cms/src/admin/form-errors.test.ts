import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { tiedErrors } from '../__testing__/form-errors.ts';
import { findUser } from './accounts.ts';
import { browser, csrfField, FIRST_ADMIN, sandbox, signedIn } from './__testing__/harness.ts';
import { SETTINGS_PAGE_FORMS, settingsPageUrl } from './__testing__/settings.ts';
import { classesOf } from './__testing__/markup.ts';
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

/** A field's error paragraph. */
const FIELD_ERROR = /<p\b[^>]*\bid="[\w-]+-error"/g;

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
  // One panel per syndication target and the Add form (TASK-218).
  'pages/documents/syndication.njk': [
    syndicationRefused('target-0'),
    syndicationRefused('target-new'),
  ],
  'pages/users/apps.njk': [
    { withoutPkce: { clients: [], field: 'client_id', value: 'x', problem: 'Wrong client.' } },
    {
      createToken: {
        name: '',
        scopes: [{ name: 'profile', label: 'Profile', checked: false }],
        expiries: [{ days: 30, selected: true }],
        problems: everyProblem,
      },
    },
  ],
};

/** The Syndication screen with one target and the Add form, `key` the one refused. */
function syndicationRefused(key: string): Record<string, unknown> {
  const form = { id: 'x', name: 'X', url: '', tag: '', languages: '' };
  const panel = (own: string): Record<string, unknown> => ({
    key: own,
    index: 0,
    was: '{}',
    form,
    problems: own === key ? everyProblem : {},
    fileProblems: [],
  });
  return { panels: [panel('target-0')], adding: panel('target-new'), refusedKey: key };
}

/**
 * Screens whose form is never shown back refused. The IndieAuth consent form
 * has nothing to type, only boxes to untick: a request it cannot answer is a
 * page of its own (`pages/indieauth/refused.njk`), never this form again. The
 * conflict screen draws its two versions in read-only boxes and posts only
 * hidden fields; a refused save there is the editor or the conflict again. An
 * empty reply on the comments screen comes back as a flash over the list.
 */
const NEVER_REFUSED: ReadonlySet<string> = new Set([
  'pages/comments/all.njk',
  'pages/indieauth/consent.njk',
  'pages/documents/conflict.njk',
]);

/** Every page that imports the field macros. */
async function templatesUsingFields(): Promise<string[]> {
  const pages = path.join(PACKAGED_ADMIN_DIR, 'pages');
  const found: string[] = [];
  for (const entry of await readdir(pages, { recursive: true })) {
    const template = `pages/${entry}`;
    if (!entry.endsWith('.njk') || NEVER_REFUSED.has(template)) continue;
    const source = await readFile(path.join(pages, entry), 'utf8');
    if (source.includes('"components/fields.njk"')) found.push(template);
  }
  return found.sort();
}

describe('every form built from the field macros, refused', async () => {
  const templates = await templatesUsingFields();

  it('is found by reading the templates', () => {
    assert.ok(templates.length >= 14, `the macro's screens were found: ${templates.join(', ')}`);
  });

  for (const template of templates) {
    for (const variant of SEPARATELY[template] ?? [{}]) {
      it(`${template} ties each error to its field and leads with a summary ${JSON.stringify(Object.keys(variant))}`, () => {
        const html = environment.render(template, { ...refused, ...variant });

        const { heading, links } = tiedErrors(html);
        const fieldErrors = html.match(FIELD_ERROR)?.length ?? 0;
        assert.equal(links.length, fieldErrors, 'every field error is in the summary');
        if (links.length === 0) {
          assert.equal(heading, 'Wrong error.', 'a form-level error heads its own summary');
        }
      });
    }
  }
});

/** The opening tag of the control with this id. */
function controlTag(html: string, id: string): string {
  const tag = new RegExp(`<(?:input|select|textarea)\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0];
  assert.ok(tag !== undefined, `there is a control #${id}`);
  return tag;
}

describe('a refused request, over HTTP', async () => {
  const box = sandbox();
  after(() => box.cleanup());

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

  const refusals = {
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

  for (const [what, refusal] of Object.entries(refusals)) {
    it(`heads the refused ${what} form with an error alert`, () => {
      const open = /<div\b[^>]*\brole="alert"[^>]*>/.exec(refusal.html)?.[0] ?? '';
      assert.deepEqual(classesOf(open), ['alert', 'alert-error']);
    });
  }

  it('announces a failed login and moves focus to it', () => {
    assert.equal(refusals.login.status, 401);
    const { heading } = tiedErrors(refusals.login.html);
    assert.equal(heading, 'That username and password do not match.');
  });

  it('links a refused settings save to the field it refused, each drawn through the validator', () => {
    const { status, html } = refusals.settings;
    assert.equal(status, 400);
    const { links } = tiedErrors(html);
    assert.deepEqual(links, ['settings-title', 'settings-timezone']);

    for (const id of links) {
      const tag = controlTag(html, id);
      assert.ok(classesOf(tag).includes('validator'), `#${id} is a validator: ${tag}`);
      const after = html.slice(html.indexOf(tag) + tag.length);
      assert.match(
        after.slice(0, after.indexOf('</div>')),
        new RegExp(`<p class="validator-hint" id="${id}-error">`),
        `#${id}'s message follows it in the same fieldset`,
      );
    }
  });

  it('ties a refused add-user form to its fields', () => {
    assert.equal(refusals.addUser.status, 400);
    assert.ok(tiedErrors(refusals.addUser.html).links.length > 0);
  });

  for (const [url, html] of Object.entries(screens)) {
    it(`${url} draws every field through the DaisyUI macros`, () => {
      const labels = [...html.matchAll(/<label class="fieldset-legend" for="([^"]+)">/g)].map(
        ([, id]) => id ?? '',
      );
      assert.ok(labels.length > 0, `${url} has fields`);
      for (const id of labels) {
        const [component] = classesOf(controlTag(html, id));
        assert.ok(
          ['input', 'select', 'textarea'].includes(component ?? ''),
          `#${id} is drawn as a DaisyUI control`,
        );
      }
    });
  }
});
