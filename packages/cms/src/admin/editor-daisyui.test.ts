import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

import { tiedErrors } from '../__testing__/form-errors.ts';
import { citedCard, fieldsOf } from './__testing__/editor-form.ts';
import { editorScreens } from './__testing__/editor-screens.ts';
import type { EditorScreen, Served } from './__testing__/editor-screens.ts';
import { sandbox } from './__testing__/harness.ts';

/**
 * The editor and the conflict screen in the DaisyUI admin (decision-30,
 * TASK-273): the writing column and the side column, the groups as collapses,
 * the buttons by what they do, the cited card, and the two versions side by
 * side, posting exactly the form the old admin posts.
 */

const execFile = promisify(execFileCallback);

const box = sandbox();
after(() => box.cleanup());

async function daisyuiScreens(): Promise<Record<EditorScreen, Served>> {
  const { stdout } = await execFile(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx'),
      path.join(import.meta.dirname, '__testing__', 'editor-probe.ts'),
    ],
    { env: { ...process.env, GEEKITY_ADMIN: 'daisyui' }, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as Record<EditorScreen, Served>;
}

const EDITORS = ['newPost', 'newPage', 'filled', 'refused', 'trashed'] as const;

function screenOf(html: string): string {
  return /<main\b[\s\S]*<\/main>/.exec(html)?.[0] ?? '';
}

function classesOf(tag: string): string[] {
  return (/\sclass="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/).filter(Boolean);
}

function classesOutsideTheBar(html: string): string[] {
  const page = html.replace(/<geekity-admin-bar\b[\s\S]*<\/geekity-admin-bar>/, '');
  return [...page.matchAll(/\bclass="([^"]*)"/g)].flatMap(([, value]) =>
    (value ?? '').split(/\s+/).filter(Boolean),
  );
}

/** The form's fields, less the two values that differ from one session or one save to the next. */
function comparable(html: string): [string, string][] {
  return fieldsOf(html).map(([name, value]): [string, string] =>
    name === 'csrf_token' || name === 'hash' ? [name, ''] : [name, value],
  );
}

/** Each disclosure's name and whether it starts open, in page order. */
function disclosures(html: string): [string, boolean][] {
  return [...html.matchAll(/<details\b([^>]*)>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/g)].map(
    ([, attributes, name]) => [(name ?? '').trim(), /\sopen\b/.test(attributes ?? '')],
  );
}

describe('the editor in the DaisyUI admin', async () => {
  const [old, served] = await Promise.all([editorScreens(box), daisyuiScreens()]);

  for (const screen of [...EDITORS, 'conflict'] as const) {
    it(`serves ${screen} with the status the old admin does`, () => {
      assert.equal(served[screen].status, old[screen].status);
    });
  }

  for (const screen of EDITORS) {
    it(`posts the same form as the old admin on ${screen}`, () => {
      assert.deepEqual(comparable(served[screen].html), comparable(old[screen].html));
    });

    it(`folds and opens the same groups as the old admin on ${screen}`, () => {
      assert.deepEqual(disclosures(served[screen].html), disclosures(old[screen].html));
    });

    it(`draws ${screen} with no class of the old admin's`, () => {
      assert.deepEqual(
        classesOutsideTheBar(served[screen].html).filter((name) => name.startsWith('admin-')),
        [],
      );
    });

    it(`draws every group on ${screen} as a DaisyUI collapse`, () => {
      const groups = [
        ...screenOf(served[screen].html).matchAll(/<details\b[^>]*>\s*<summary\b[^>]*>/g),
      ];
      assert.ok(groups.length > 0, 'the editor has groups');
      for (const [tags] of groups) {
        const [details = '', summary = ''] = tags.split(/>\s*</);
        assert.ok(classesOf(`${details}>`).includes('collapse'), details);
        assert.ok(classesOf(`<${summary}`).includes('collapse-title'), summary);
      }
    });
  }

  it('lays the writing column and the side column side by side from xl, and stacks them below', () => {
    const form =
      /<form\b[^>]*>\s*<input type="hidden" name="csrf_token"[^>]*>\s*<input type="hidden" name="hash"/.exec(
        served.filled.html,
      )?.[0];
    assert.ok(form !== undefined);
    const classes = classesOf(form);
    assert.ok(classes.includes('grid'), form);
    assert.ok(
      classes.some((name) => name.startsWith('xl:grid-cols-')),
      `two columns from xl: ${form}`,
    );
    assert.ok(!classes.some((name) => /^grid-cols-/.test(name)), `one column below xl: ${form}`);
  });

  it('draws each action as a button, the one that publishes in the primary colour', () => {
    const buttons = (html: string): Record<string, string[]> =>
      Object.fromEntries(
        [...screenOf(html).matchAll(/<button\b[^>]*\bname="action"[^>]*>/g)].map(([tag]) => [
          /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? '',
          classesOf(tag),
        ]),
      );

    const fresh = buttons(served.newPost.html);
    assert.deepEqual(Object.keys(fresh), ['save-draft', 'publish']);
    assert.ok(fresh['save-draft']?.includes('btn'));
    assert.ok(fresh['publish']?.includes('btn-primary'));

    const published = buttons(served.filled.html);
    assert.deepEqual(Object.keys(published), ['update', 'trash']);
    assert.ok(published['update']?.includes('btn-primary'));
    assert.ok(published['trash']?.includes('btn-error'));
    assert.match(served.filled.html, /name="action" value="trash">Move to trash</);
    assert.match(
      screenOf(served.filled.html),
      /<a class="btn\b[^"]*" href="\/2026\/10\/everything\/">View<\/a>/,
    );

    assert.deepEqual(Object.keys(buttons(served.trashed.html)), ['update', 'restore']);
  });

  it('keeps the no-script Preview a button that posts the form to the preview in a new tab', () => {
    const tag = /<button\b[^>]*\bid="editor-preview-fallback"[^>]*>/.exec(served.newPost.html)?.[0];
    assert.ok(tag !== undefined);
    assert.ok(classesOf(tag).includes('btn'), tag);
    assert.match(tag, /\btype="submit"/);
    assert.match(tag, /\bformaction="\/admin\/preview"/);
    assert.match(tag, /\bformtarget="_blank"/);
    assert.match(tag, /\sformnovalidate\b/);
  });

  it('says a trashed post is in the trash as news, not as an alert', () => {
    const note =
      /<div role="(\w+)"[^>]*class="alert\b[^"]*">[^<]*<span>This post is in the trash/.exec(
        served.trashed.html,
      );
    assert.equal(note?.[1], 'status');
  });

  it('keeps the refused summary the only alert, ahead of every autofocus', () => {
    assert.deepEqual(tiedErrors(served.refused.html).links, ['editor-cited-alt']);
  });

  it('draws the cited page as a card with its Remove toggle and alt-text field', () => {
    const html = served.filled.html;
    const card = citedCard(html) ?? '';
    assert.ok(
      html.indexOf(card) > html.indexOf('id="editor-repost-of"'),
      'the card is under the cited address',
    );
    assert.match(card, /^<div class="card\b/);

    assert.match(card, /<img\b[^>]*\bsrc="\/uploads\/cited\/[^"]+"[^>]*\balt=""/);
    assert.match(card, /An image from edu\.example/);
    const toggle = /<input\b[^>]*\bid="editor-preview-repost-of"[^>]*>/.exec(card)?.[0] ?? '';
    assert.match(toggle, /\btype="checkbox"/);
    assert.match(toggle, /\bname="preview" value="hide"/);
    assert.match(
      card,
      /<label\b[^>]*\bfor="editor-preview-repost-of"[^>]*>[\s\S]*?Remove the preview of An image from edu\.example[\s\S]*?<\/label>/,
    );
    assert.match(
      card,
      /Removed\. The post shows the plain citation until you select the X again\./,
    );
    assert.match(
      card,
      /<input id="editor-cited-alt" name="cited-alt" type="text" value="Everything"/,
    );
    assert.match(
      card,
      /<p\b[^>]*\bid="editor-cited-alt-hint"[^>]*>What the image shows/,
      'the alt-text hint',
    );
  });

  it('shows the two versions of a conflicting edit side by side, read-only', () => {
    const html = screenOf(served.conflict.html);
    const grid = /<div class="([^"]*)">\s*<div class="card\b/.exec(html)?.[1] ?? '';
    assert.ok(grid.split(/\s+/).includes('grid'), grid);
    assert.ok(
      grid.split(/\s+/).some((name) => name.endsWith(':grid-cols-2')),
      grid,
    );

    const versions = [...html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)].filter(
      ([, attributes]) => /\sreadonly\b/.test(attributes ?? ''),
    );
    assert.equal(versions.length, 2);
    assert.match(versions[0]?.[2] ?? '', /^---[\s\S]*title: Everything[\s\S]*Every box\./);
    assert.match(versions[1]?.[2] ?? '', /^---[\s\S]*title: Everything[\s\S]*Every box\./);
    assert.deepEqual(
      classesOutsideTheBar(served.conflict.html).filter((name) => name.startsWith('admin-')),
      [],
    );
  });

  it('offers the conflict’s two ways out: edit the file on disk, or overwrite it with this hash', () => {
    const html = screenOf(served.conflict.html);
    assert.match(
      html,
      /<a class="btn\b[^"]*" href="\/admin\/posts\/everything">Discard mine and edit the file on disk<\/a>/,
    );
    const form =
      /<form\b[^>]*action="\/admin\/posts\/everything"[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? '';
    const hash = /name="hash" value="([^"]*)"/.exec(form)?.[1] ?? '';
    assert.match(hash, /^[0-9a-f]{16,}$/);
    assert.match(form, /<textarea\b[^>]*\bname="body"[^>]*\shidden\b[^>]*>Every box\./);
    assert.match(
      form,
      /<button type="submit" class="btn\b[^"]*" name="action" value="publish">Keep mine and overwrite the file<\/button>/,
    );
  });
});
