/**
 * Editor actions (decision-33, TASK-285): a plugin's button beside the title,
 * description or tags field, the JSON endpoint it posts the draft to, and
 * what the editor is when the plugin is not running.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Cms } from '../index.ts';
import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin, PluginEditorDraft, PluginEditorSuggestion } from '../plugin.ts';
import { elementAt, fieldsOf } from './__testing__/editor-form.ts';
import { browser, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { adminContentSecurityPolicy } from './headers.ts';

const box = sandbox();
after(() => box.cleanup());

const NAME = '@test/plugin-suggest';
const ENDPOINT = `/admin/plugins/${NAME}/editor`;

interface Pressed {
  drafts: PluginEditorDraft[];
}

/** A plugin with a button beside each field; the title one is not offered for a like. */
function suggester(
  pressed: Pressed = { drafts: [] },
  answer: (draft: PluginEditorDraft) => PluginEditorSuggestion = () => ({
    ok: true,
    value: 'A suggestion',
  }),
): Plugin {
  return definePlugin({
    name: NAME,
    version: '1.0.0',
    label: 'Suggest',
    description: 'Suggests things.',
    hostApi: HOST_API_VERSION,
    register(host) {
      const suggest = ({ draft }: { draft: PluginEditorDraft }) => {
        pressed.drafts.push(draft);
        return answer(draft);
      };
      host.editorAction({
        id: 'suggest-title',
        field: 'title',
        label: 'Suggest title',
        offers: (draft) => draft.postType !== 'like',
        suggest,
      });
      host.editorAction({
        id: 'suggest-description',
        field: 'description',
        label: 'Suggest description',
        suggest,
      });
      host.editorAction({ id: 'suggest-tags', field: 'tags', label: 'Suggest tags', suggest });
    },
  });
}

async function site(
  plugins: Plugin[],
  enabled: boolean,
  posts: Record<string, string> = {},
): Promise<{ cms: Cms; agent: Browser; contentDir: string }> {
  const contentDir = await box.dir('geekity-editor-actions-content-');
  const dataDir = await box.dir('geekity-editor-actions-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({
      title: 'A Site',
      language: 'en',
      plugins: enabled ? Object.fromEntries(plugins.map((p) => [p.name, { enabled: true }])) : {},
    }),
  );
  await writeFile(
    path.join(contentDir, 'posts', 'loaf.md'),
    '---\ntitle: Loaf\ndate: 2026-09-01T09:00:00Z\ntags: [bread, Baking]\n---\n\nRisen.\n',
  );
  await writeFile(
    path.join(contentDir, 'posts', 'rye.md'),
    '---\ntitle: Rye\ndate: 2026-09-02T09:00:00Z\ntags: [Baking]\n---\n\nDense.\n',
  );
  await writeFile(
    path.join(contentDir, 'posts', 'liked.md'),
    '---\ndate: 2026-10-01T09:00:00Z\nlike-of: https://elsewhere.example/post\n---\n\nGood one.\n',
  );
  for (const [name, text] of Object.entries(posts)) {
    await writeFile(path.join(contentDir, 'posts', name), text);
  }
  const cms = await box.open({ contentDir, dataDir, plugins });
  return { cms, agent: await signedIn(cms), contentDir };
}

/** The editor with what changes per request (token, nonce, clock) blanked out. */
function stable(html: string): string {
  return html
    .replace(/name="csrf_token"\s+value="[^"]*"/g, 'name="csrf_token" value=""')
    .replace(/nonce="[^"]*"/g, 'nonce=""')
    .replace(/(id="editor-date"[^>]*value=")[^"]*"/, '$1"');
}

/** The block of actions drawn after a field, or `undefined`. */
function actionsBeside(html: string, fieldId: string): string | undefined {
  const start = html.search(new RegExp(`<div[^>]*data-editor-actions="${fieldId}"`));
  return start === -1 ? undefined : elementAt(html, start);
}

async function press(
  agent: Browser,
  editorUrl: string,
  id: string,
  fields: Record<string, string> = {},
): Promise<Response> {
  const html = await (await agent.get(editorUrl)).text();
  const form = Object.fromEntries(fieldsOf(html));
  return agent.post(`${ENDPOINT}/${id}`, { ...form, ...fields });
}

describe('editor actions', () => {
  it('draws an enabled plugin’s button beside the title, description and tags fields', async () => {
    const { agent } = await site([suggester()], true);
    const html = await (await agent.get('/admin/posts/new')).text();

    for (const [field, id, label] of [
      ['editor-title', 'suggest-title', 'Suggest title'],
      ['editor-description', 'suggest-description', 'Suggest description'],
      ['editor-tags', 'suggest-tags', 'Suggest tags'],
    ] as const) {
      const block = actionsBeside(html, field);
      assert.ok(block !== undefined, `a block of actions follows ${field}`);
      assert.ok(
        block.includes(`data-editor-action="${ENDPOINT}/${id}"`),
        `${id} posts to its endpoint`,
      );
      assert.match(block, new RegExp(`<button type="button"[^>]*hidden>${label}</button>`));
      assert.ok(
        html.indexOf(`id="${field}"`) < html.indexOf(`data-editor-actions="${field}"`),
        `the ${label} block comes after its field`,
      );
    }
    assert.match(html, /<script defer src="\/admin\/_static\/editor-actions\.js"><\/script>/);
  });

  it('leaves the editor exactly as it is without the plugin when the plugin is disabled', async () => {
    const plain = await site([], false);
    const disabled = await site([suggester()], false);
    for (const url of ['/admin/posts/new', '/admin/pages/new', '/admin/posts/liked']) {
      const without = stable(await (await plain.agent.get(url)).text());
      const off = stable(await (await disabled.agent.get(url)).text());
      assert.equal(off, without, `${url} is unchanged`);
      assert.doesNotMatch(off, /editor-actions/);
    }
  });

  it('adds no field to the form, so a save with JavaScript off posts what it did before', async () => {
    const plain = await site([], false);
    const on = await site([suggester()], true);
    const fields = async (agent: Browser) =>
      fieldsOf(stable(await (await agent.get('/admin/posts/liked')).text()));
    assert.deepEqual(await fields(on.agent), await fields(plain.agent));
  });

  it('does not draw a button its plugin does not offer for the draft', async () => {
    const { agent } = await site([suggester()], true);
    const html = await (await agent.get('/admin/posts/liked')).text();
    assert.equal(actionsBeside(html, 'editor-title'), undefined);
    assert.ok(actionsBeside(html, 'editor-description') !== undefined);
  });

  it('hands the plugin the draft as the form holds it and answers its suggestion as JSON', async () => {
    const pressed: Pressed = { drafts: [] };
    const { agent, contentDir } = await site([suggester(pressed)], true);
    const file = path.join(contentDir, 'posts', 'liked.md');
    const before = await readFile(file, 'utf8');

    const response = await press(agent, '/admin/posts/liked', 'suggest-description', {
      title: '',
      body: 'Unsaved words.',
      tags: 'one, two',
      lang: 'fr',
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.deepEqual(await response.json(), { ok: true, value: 'A suggestion' });
    assert.deepEqual(pressed.drafts, [
      {
        type: 'post',
        postType: 'like',
        saved: true,
        title: '',
        body: 'Unsaved words.',
        description: '',
        tags: ['one', 'two'],
        lang: 'fr',
      },
    ]);
    assert.equal(await readFile(file, 'utf8'), before, 'nothing was saved');
  });

  it('reads a new untitled post as an unsaved note, a titled one as an article, a page as a page', async () => {
    const pressed: Pressed = { drafts: [] };
    const { agent } = await site([suggester(pressed)], true);
    await press(agent, '/admin/posts/new', 'suggest-tags', { body: 'Just a thought.' });
    await press(agent, '/admin/posts/new', 'suggest-tags', {
      title: 'A Long Read',
      body: 'Many words.',
    });
    await press(agent, '/admin/pages/new', 'suggest-tags', { title: 'About', body: 'Me.' });
    assert.deepEqual(
      pressed.drafts.map(({ type, postType, saved, lang }) => ({ type, postType, saved, lang })),
      [
        { type: 'post', postType: 'note', saved: false, lang: 'en' },
        { type: 'post', postType: 'article', saved: false, lang: 'en' },
        { type: 'page', postType: undefined, saved: false, lang: 'en' },
      ],
    );
  });

  it('withdraws a button the draft no longer qualifies for, without asking the plugin', async () => {
    const pressed: Pressed = { drafts: [] };
    const { agent } = await site([suggester(pressed)], true);
    const response = await press(agent, '/admin/posts/new', 'suggest-title', {
      'like-of': 'https://elsewhere.example/post',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: false,
      withdrawn: true,
      message: 'Suggest title is not offered for a like.',
    });
    assert.deepEqual(pressed.drafts, []);
  });

  it('answers the plugin’s own failure, and one it threw, in plain words', async () => {
    const failing = await site(
      [suggester(undefined, () => ({ ok: false, message: 'The model is asleep.' }))],
      true,
    );
    assert.deepEqual(
      await (await press(failing.agent, '/admin/posts/new', 'suggest-tags')).json(),
      {
        ok: false,
        message: 'The model is asleep.',
      },
    );

    const throwing = await site(
      [
        suggester(undefined, () => {
          throw new Error('kaboom');
        }),
      ],
      true,
    );
    const response = await press(throwing.agent, '/admin/posts/new', 'suggest-tags');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { ok: false, message: 'Suggest tags failed: kaboom' });
  });

  it('answers 404 for a disabled plugin and for an action it does not have', async () => {
    const pressed: Pressed = { drafts: [] };
    const disabled = await site([suggester(pressed)], false);
    assert.equal((await press(disabled.agent, '/admin/posts/new', 'suggest-tags')).status, 404);

    const enabled = await site([suggester(pressed)], true);
    assert.equal((await press(enabled.agent, '/admin/posts/new', 'suggest-nothing')).status, 404);
    assert.deepEqual(pressed.drafts, []);
  });

  it('refuses a request with no session or no CSRF token, and asks the plugin nothing', async () => {
    const pressed: Pressed = { drafts: [] };
    const { cms, agent } = await site([suggester(pressed)], true);

    const stranger = browser(cms);
    const anonymous = await stranger.post(`${ENDPOINT}/suggest-tags`, { body: 'x' });
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get('location'), '/admin/login');

    const forged = await agent.post(`${ENDPOINT}/suggest-tags`, { body: 'x', csrf_token: 'nope' });
    assert.equal(forged.status, 403);
    assert.deepEqual(pressed.drafts, []);
  });

  it('hands the plugin the tags the site already uses, most used first', async () => {
    const seen: (readonly string[])[] = [];
    const tagger = definePlugin({
      name: NAME,
      version: '1.0.0',
      label: 'Tagger',
      description: 'Suggests tags.',
      hostApi: HOST_API_VERSION,
      register(host) {
        host.editorAction({
          id: 'suggest-tags',
          field: 'tags',
          label: 'Suggest tags',
          suggest: ({ siteTags }) => {
            seen.push(siteTags);
            return { ok: true, value: '' };
          },
        });
      },
    });
    const { agent } = await site([tagger], true);
    await press(agent, '/admin/posts/new', 'suggest-tags', { body: 'Crumb.' });
    assert.deepEqual(seen, [['Baking', 'bread']]);
  });

  it('hands the plugin the titles of the site’s latest posts, newest first, the draft’s own left out', async () => {
    const seen: (readonly string[])[] = [];
    const titler = definePlugin({
      name: NAME,
      version: '1.0.0',
      label: 'Titler',
      description: 'Suggests titles.',
      hostApi: HOST_API_VERSION,
      register(host) {
        host.editorAction({
          id: 'suggest-title',
          field: 'title',
          label: 'Suggest title',
          suggest: ({ recentTitles }) => {
            seen.push(recentTitles);
            return { ok: true, value: '' };
          },
        });
      },
    });
    const days = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `day-${String(10 + index)}.md`,
        `---\ntitle: Day ${String(10 + index)}\ndate: 2026-09-${String(10 + index)}T09:00:00Z\n---\n\nText.\n`,
      ]),
    );
    const { agent } = await site([titler], true, {
      ...days,
      'later.md': '---\ndate: 2026-09-30T09:00:00Z\n---\n\nAn untitled note.\n',
    });
    await press(agent, '/admin/posts/new', 'suggest-title', { body: 'Crumb.', title: 'Day 21' });
    assert.deepEqual(seen, [
      [
        'Day 20',
        'Day 19',
        'Day 18',
        'Day 17',
        'Day 16',
        'Day 15',
        'Day 14',
        'Day 13',
        'Day 12',
        'Day 11',
      ],
    ]);
  });

  it('answers a plugin’s choices as JSON, each with its note, badge and group', async () => {
    const choices = [
      { value: 'bread', note: '120 followers', badge: 'Used here', group: 'For this post' },
      { value: 'crumb', note: 'followers unknown', group: 'For this post' },
      { value: 'oven', group: 'For reach' },
    ];
    const { agent } = await site([suggester(undefined, () => ({ ok: true, choices }))], true);
    const response = await press(agent, '/admin/posts/new', 'suggest-tags');
    assert.deepEqual(await response.json(), { ok: true, choices });
  });

  it('refuses choices beside a field that holds one value', async () => {
    const { agent } = await site(
      [suggester(undefined, () => ({ ok: true, choices: [{ value: 'One' }] }))],
      true,
    );
    const response = await press(agent, '/admin/posts/new', 'suggest-description');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      ok: false,
      message:
        'Suggest description failed: it offered choices for the description, which holds one value',
    });
  });

  it('draws a hidden list for choices beside each button, with a row to copy', async () => {
    const { agent } = await site([suggester()], true);
    const block = actionsBeside(await (await agent.get('/admin/posts/new')).text(), 'editor-tags');
    assert.ok(block !== undefined);
    assert.match(block, /<ul[^>]*data-editor-choices[^>]*>\s*<\/ul>/);
    assert.match(
      block,
      /<template data-editor-choice>[\s\S]*<input type="checkbox"[\s\S]*<\/template>/,
    );
    assert.match(block, /<template data-editor-choice-group>\s*<li[^>]*data-choice-group[^>]*>/);
  });

  it('gives each choice box to a form of its own, so saving the draft never posts it', async () => {
    const { agent } = await site([suggester()], true);
    const html = await (await agent.get('/admin/posts/new')).text();
    const box = /<template data-editor-choice>[\s\S]*?(<input type="checkbox"[^>]*>)/.exec(
      actionsBeside(html, 'editor-tags') ?? '',
    )?.[1];
    const owner = /\bform="([^"]+)"/.exec(box ?? '')?.[1];
    assert.ok(owner !== undefined, 'the choice box names the form it belongs to');
    assert.match(html, new RegExp(`<form id="${owner}" hidden></form>`));
  });

  it('runs under the admin’s own policy, the script coming from the admin’s origin', async () => {
    const { agent } = await site([suggester()], true);
    const response = await agent.get('/admin/posts/new');
    const html = await response.text();
    const nonce = /<script[^>]*id="editor-script"[^>]*nonce="([^"]+)"/.exec(html)?.[1] ?? '';
    assert.equal(
      response.headers.get('content-security-policy'),
      adminContentSecurityPolicy(nonce),
    );

    const script = await agent.get('/admin/_static/editor-actions.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);
    const source = await script.text();
    assert.doesNotMatch(source, /https?:\/\//, 'the script calls nothing off the site');
  });
});
