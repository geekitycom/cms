import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

import { tiedErrors } from '../__testing__/form-errors.ts';
import {
  browser,
  csrfField,
  FIRST_ADMIN,
  sandbox,
  setUpFirstAdmin,
  signedIn,
} from './__testing__/harness.ts';
import {
  adminDirectories,
  createAdminTemplateEnvironment,
  PACKAGED_ADMIN_DIR,
} from './templates.ts';

/**
 * Every admin form built from `components/fields.njk`, refused (TASK-142).
 *
 * The screens are found by reading the templates rather than from a list, so
 * a form added later is held to the same contract without anybody
 * remembering to add it here: rendered with a problem on every field it could
 * fault, it has one summary that takes focus, and every field the summary
 * links to is marked invalid and names its message. Every screen is held to
 * that in both admins: the old one, and the DaisyUI one laid over it
 * (decision-30), whose field macros every unconverted screen picks up by name.
 */

const execFile = promisify(execFileCallback);

const ADMINS = [
  { name: 'the old admin', roots: [PACKAGED_ADMIN_DIR] },
  { name: 'the DaisyUI admin', roots: adminDirectories({ GEEKITY_ADMIN: 'daisyui' }) },
].map(({ name, roots }) => ({
  name,
  roots,
  environment: createAdminTemplateEnvironment({ noCache: true, roots }),
}));

/** A field's error paragraph, whichever admin wrote it. */
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

/** Every page under `roots` that imports the field macros, as the first root that has it. */
async function templatesUsingFields(roots: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const root of roots) {
    const pages = path.join(root, 'pages');
    if (!existsSync(pages)) continue;
    for (const entry of await readdir(pages, { recursive: true })) {
      const template = `pages/${entry}`;
      if (!entry.endsWith('.njk') || found.has(template) || NEVER_REFUSED.has(template)) continue;
      const first = roots.map((dir) => path.join(dir, template)).find((file) => existsSync(file));
      const source = await readFile(first ?? path.join(pages, entry), 'utf8');
      if (source.includes('"components/fields.njk"')) found.add(template);
    }
  }
  return [...found].sort();
}

for (const admin of ADMINS) {
  describe(`every form in ${admin.name} built from the field macros, refused`, async () => {
    const templates = await templatesUsingFields(admin.roots);

    it('is found by reading the templates', () => {
      assert.ok(templates.length >= 14, `the macro's screens were found: ${templates.join(', ')}`);
    });

    for (const template of templates) {
      for (const variant of SEPARATELY[template] ?? [{}]) {
        it(`${template} ties each error to its field and leads with a summary ${JSON.stringify(Object.keys(variant))}`, () => {
          const html = admin.environment.render(template, { ...refused, ...variant });

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
}

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

/** The opening tag of the control with this id. */
function controlTag(html: string, id: string): string {
  const tag = new RegExp(`<(?:input|select|textarea)\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0];
  assert.ok(tag !== undefined, `there is a control #${id}`);
  return tag;
}

/** The names in a tag's class attribute. */
function classesOf(tag: string): string[] {
  return (/\sclass="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/).filter(Boolean);
}

describe('a refused request, over HTTP, with GEEKITY_ADMIN=daisyui', async () => {
  const { stdout } = await execFile(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx'),
      path.join(import.meta.dirname, '__testing__', 'fields-probe.ts'),
    ],
    { env: { ...process.env, GEEKITY_ADMIN: 'daisyui' }, maxBuffer: 64 * 1024 * 1024 },
  );
  const served = JSON.parse(stdout) as {
    refused: Record<'login' | 'settings' | 'addUser', { status: number; html: string }>;
    screens: Record<string, string>;
  };

  for (const [what, refusal] of Object.entries(served.refused)) {
    it(`heads the refused ${what} form with the DaisyUI error alert`, () => {
      const open = /<div\b[^>]*\brole="alert"[^>]*>/.exec(refusal.html)?.[0] ?? '';
      assert.deepEqual(classesOf(open), ['alert', 'alert-error']);
    });
  }

  it('announces a failed login and moves focus to it', () => {
    assert.equal(served.refused.login.status, 401);
    const { heading } = tiedErrors(served.refused.login.html);
    assert.equal(heading, 'That username and password do not match.');
  });

  it('links a refused settings save to the field it refused, each drawn through the validator', () => {
    const { status, html } = served.refused.settings;
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
    assert.equal(served.refused.addUser.status, 400);
    assert.ok(tiedErrors(served.refused.addUser.html).links.length > 0);
  });

  for (const [url, html] of Object.entries(served.screens)) {
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
      assert.doesNotMatch(html, /\b(?:admin-field-error|admin-check)\b/, 'no old field markup');
    });
  }
});
