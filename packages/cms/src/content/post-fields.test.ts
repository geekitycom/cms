/**
 * The post field table (TASK-353 AC #3): a row added to a kind's fields, and
 * nowhere else, is read into the editor form, written back to the file, and
 * mapped both ways by Micropub.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { submittedForm } from '../admin/documents.ts';
import { resolveConfig } from '../config.ts';
import { createForm } from '../micropub/create.ts';
import { sourceProperties, updateForm } from '../micropub/update.ts';
import { stringOrEmpty } from '../util/forms.ts';
import type { Document } from './document.ts';
import { blankForm, formFor } from './document-form.ts';
import type { EditorForm } from './document-form.ts';
import { POST_KIND } from './document-kind.ts';
import type { DocumentKind } from './document-kind.ts';
import { keptProperties } from './kept-properties.ts';
import { postLocations } from './locations.ts';
import type { PostField } from './post-fields.ts';
import { openContentStore } from './store.ts';
import type { ContentStore } from './store.ts';
import { writeDocument } from './write.ts';
import type { DocumentSite } from './write.ts';

const temporaryDirs: string[] = [];
const stores: ContentStore[] = [];

after(async () => {
  for (const store of stores) store.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

const NOW = new Date('2026-09-02T10:00:00.000Z');

/** A form that also has the field the test adds, which `EditorForm` does not declare. */
interface MoodForm extends EditorForm {
  mood: string;
}

function mood(value: string): Partial<EditorForm> {
  const form: Partial<EditorForm> = {};
  Object.assign(form, { mood: value });
  return form;
}

function moodOf(document: Document): string {
  const value = document.extra['mood'];
  return typeof value === 'string' ? value : '';
}

const MOOD_FIELD: PostField = {
  read: (document) => mood(moodOf(document)),
  submitted: (body) => mood(stringOrEmpty(body['mood']).trim()),
  write: (extra, form) => {
    const value = (form as MoodForm).mood;
    if (value === '') delete extra['mood'];
    else extra['mood'] = value;
  },
  micropub: {
    properties: { mood: ['mood' as keyof EditorForm] },
    publishable: [],
    toForm: (request) => mood(request.text('mood')),
    toProperties: (document) => (moodOf(document) === '' ? {} : { mood: [moodOf(document)] }),
  },
};

const MOODY_KIND: DocumentKind = { ...POST_KIND, fields: [...POST_KIND.fields, MOOD_FIELD] };

async function scratch() {
  const contentDir = await temporaryDir('geekity-post-fields-content-');
  const dataDir = await temporaryDir('geekity-post-fields-data-');
  const store = openContentStore({ dataDir, now: () => NOW });
  stores.push(store);
  const site: DocumentSite = {
    store,
    config: resolveConfig({ contentDir, dataDir, baseUrl: 'https://example.com' }),
    announce: () => Promise.resolve(),
    writer: undefined,
    citedContext: () => Promise.resolve(undefined),
    storedContext: () => undefined,
    learnHandles: () => Promise.resolve(),
  };
  const micropub = {
    author: 'ada',
    timezone: 'UTC',
    now: NOW,
    baseUrl: 'https://example.com',
    targets: [],
    locations: postLocations(dataDir),
    kept: keptProperties(dataDir),
  };
  return { site, contentDir, micropub };
}

async function saved(site: DocumentSite, form: EditorForm, document?: Document): Promise<Document> {
  const written = await writeDocument(site, { kind: MOODY_KIND, document, form, draft: true });
  assert.equal(written.outcome, 'saved', JSON.stringify(written));
  return written.saved;
}

describe('a field added to the table alone (TASK-353 AC #3)', () => {
  it('round-trips through the editor form', async () => {
    const { site, contentDir } = await scratch();

    const submitted = submittedForm(
      MOODY_KIND,
      { title: 'Moody', body: 'Hello.', mood: ' sunny ' },
      contentDir,
    );
    assert.equal((submitted as MoodForm).mood, 'sunny');

    const first = await saved(site, submitted);
    assert.equal(first.extra['mood'], 'sunny');
    const file = await readFile(path.join(contentDir, ...first.path.split('/')), 'utf8');
    assert.match(file, /^mood: sunny$/m);

    const loaded = formFor(MOODY_KIND, first, 'UTC', undefined);
    assert.equal((loaded as MoodForm).mood, 'sunny');

    const cleared = await saved(site, { ...loaded, mood: '' } as MoodForm, first);
    assert.equal(cleared.extra['mood'], undefined);
    assert.equal((formFor(MOODY_KIND, cleared, 'UTC', undefined) as MoodForm).mood, '');
  });

  it('round-trips through Micropub create, q=source and update', async () => {
    const { site, micropub } = await scratch();
    const request = {
      type: 'h-entry',
      properties: new Map<string, unknown[]>([
        ['content', ['Hello.']],
        ['mood', ['happy']],
      ]),
    };

    const created = createForm(request, micropub, MOODY_KIND);
    assert.ok('form' in created, JSON.stringify(created));
    assert.equal((created.form as MoodForm).mood, 'happy');
    assert.deepEqual(created.keptProperties, {});

    const first = await saved(site, created.form);
    assert.equal(first.extra['mood'], 'happy');
    assert.deepEqual(sourceProperties(first, micropub, MOODY_KIND)['mood'], ['happy']);

    const updated = updateForm(
      first,
      [{ op: 'replace', property: 'mood', values: ['calm'] }],
      micropub,
      MOODY_KIND,
    );
    assert.ok('form' in updated, JSON.stringify(updated));
    const second = await saved(site, updated.form, first);
    assert.equal(second.extra['mood'], 'calm');
    assert.equal(second.body, first.body);
    assert.deepEqual(sourceProperties(second, micropub, MOODY_KIND)['mood'], ['calm']);
  });

  it('is kept privately by a kind whose table does not have the row', () => {
    const created = createForm(
      {
        type: 'h-entry',
        properties: new Map([
          ['content', ['Hello.']],
          ['mood', ['happy']],
        ]),
      },
      {
        author: 'ada',
        timezone: 'UTC',
        now: NOW,
        baseUrl: 'https://example.com',
        targets: [],
      },
    );
    assert.ok('form' in created);
    assert.deepEqual(created.keptProperties, { mood: ['happy'] });
    assert.equal((blankForm(POST_KIND) as Partial<MoodForm>).mood, undefined);
  });
});
