import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { tiedErrors } from '../__testing__/form-errors.ts';
import { remoteHostsDoNotExist } from '../__testing__/offline.ts';
import { citedCard, fieldsOf } from './__testing__/editor-form.ts';
import { editorScreens } from './__testing__/editor-screens.ts';
import { sandbox } from './__testing__/harness.ts';
import { classesOf, classesOutsideTheBar, screenOf } from './__testing__/markup.ts';

const box = sandbox();
remoteHostsDoNotExist();
after(() => box.cleanup());

const EDITORS = ['newPost', 'newPage', 'filled', 'refused', 'trashed'] as const;

/** The status each screen is served with. */
const STATUSES = {
  newPost: 200,
  newPage: 200,
  filled: 200,
  refused: 400,
  trashed: 200,
  conflict: 409,
} as const;

/** Each editor's groups, and whether each starts open, in page order. */
const GROUPS: Readonly<Record<(typeof EDITORS)[number], [string, boolean][]>> = {
  newPost: [
    ['Photos', false],
    ['Add a photo', false],
    ['Location', false],
    ['Recording', false],
    ['Other versions', false],
    ['Add a version', false],
    ['Publishing', true],
    ['Tags and categories', true],
    ['Address', false],
    ['Responding to', false],
    ['Event', false],
    ['Read', false],
    ['Summary and language', false],
    ['Syndicate to', false],
    ['Display and discussion', false],
  ],
  newPage: [
    ['Publishing', true],
    ['Address', false],
    ['Summary and language', false],
    ['Display and discussion', false],
  ],
  filled: [
    ['Photos', true],
    ['Photo 1', true],
    ['Add a photo', false],
    ['Location', true],
    ['Recording', true],
    ['Other versions', true],
    ['Version 1', true],
    ['Add a version', false],
    ['Publishing', true],
    ['Tags and categories', true],
    ['Address', true],
    ['Responding to', true],
    ['Event', false],
    ['Read', true],
    ['Summary and language', true],
    ['Syndicate to', true],
    ['Display and discussion', true],
  ],
  refused: [
    ['Photos', false],
    ['Add a photo', false],
    ['Location', false],
    ['Recording', false],
    ['Other versions', false],
    ['Add a version', false],
    ['Publishing', true],
    ['Tags and categories', true],
    ['Address', false],
    ['Responding to', true],
    ['Event', false],
    ['Read', false],
    ['Summary and language', false],
    ['Syndicate to', false],
    ['Display and discussion', false],
  ],
  trashed: [
    ['Photos', false],
    ['Add a photo', false],
    ['Location', false],
    ['Recording', false],
    ['Other versions', false],
    ['Add a version', false],
    ['Publishing', true],
    ['Tags and categories', true],
    ['Address', true],
    ['Responding to', false],
    ['Event', false],
    ['Read', false],
    ['Summary and language', false],
    ['Syndicate to', false],
    ['Display and discussion', false],
  ],
};

/** What the filled-in editor posts, less the session's token and the file's hash. */
const FILLED_FORM: [string, string][] = [
  ['alternate-height-0', ''],
  ['alternate-height-1', ''],
  ['alternate-lang-0', ''],
  ['alternate-lang-1', ''],
  ['alternate-title-0', ''],
  ['alternate-title-1', ''],
  ['alternate-type-0', 'video/mp4'],
  ['alternate-type-1', ''],
  ['alternate-url-0', '/uploads/2026/10/episode.mp4'],
  ['alternate-url-1', ''],
  ['author', 'ada'],
  ['body', 'Every box.'],
  ['bookmark-of', ''],
  ['categories', ''],
  ['cited-alt', 'Everything'],
  ['comments', 'closed'],
  ['csrf_token', ''],
  ['date', '2026-10-02 09:00:00'],
  ['description', ''],
  ['enclosure-duration', ''],
  ['enclosure-transcript-type', ''],
  ['enclosure-transcript-url', ''],
  ['enclosure-url', '/uploads/2026/10/episode.mp3'],
  ['event-end', ''],
  ['event-location', ''],
  ['event-start', ''],
  ['hash', ''],
  ['in-reply-to', ''],
  ['lang', 'fr'],
  ['like-of', ''],
  ['location-accuracy', ''],
  ['location-country', ''],
  ['location-geo', ''],
  ['location-locality', ''],
  ['location-name', 'The pier'],
  ['location-region', ''],
  ['permalink', '/2026/10/everything/'],
  ['photo-alt-0', 'A photo'],
  ['photo-alt-1', ''],
  ['photo-url-0', 'https://example.com/a.jpg'],
  ['photo-url-1', ''],
  ['read-of-author', ''],
  ['read-of-name', 'A book'],
  ['read-of-uid', ''],
  ['read-of-url', ''],
  ['read-status', 'finished'],
  ['repost-of', 'https://edu.example/files/calculator.png'],
  ['rsvp', ''],
  ['slug', 'everything'],
  ['syndicate-to-mastodon', '1'],
  ['tags', 'one'],
  ['title', 'Everything'],
  ['type', 'post'],
  ['visibility', 'public'],
];

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

describe('the editor', async () => {
  const served = await editorScreens(box);

  for (const screen of [...EDITORS, 'conflict'] as const) {
    it(`serves ${screen} with status ${String(STATUSES[screen])}`, () => {
      assert.equal(served[screen].status, STATUSES[screen]);
    });
  }

  it('posts every box of a filled-in post', () => {
    assert.deepEqual(comparable(served.filled.html), FILLED_FORM);
  });

  for (const screen of EDITORS) {
    it(`folds and opens the groups on ${screen} by what they hold`, () => {
      assert.deepEqual(disclosures(served[screen].html), GROUPS[screen]);
    });

    it(`draws ${screen} with no admin-* class outside the bar`, () => {
      assert.deepEqual(
        classesOutsideTheBar(served[screen].html).filter((name) => name.startsWith('admin-')),
        [],
      );
    });

    it(`draws every group on ${screen} as a collapse`, () => {
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
