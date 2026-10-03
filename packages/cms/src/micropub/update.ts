import { formFor } from '../admin/documents.ts';
import type { EditorForm } from '../admin/documents.ts';
import { photoRows } from '../admin/photo-field.ts';
import { citationsOf } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import { syndicateToOf } from '../webmention/syndication.ts';
import { createForm, propertyName } from './create.ts';
import type { CreateSite } from './create.ts';

/**
 * The properties an update may change, and the editor fields each one owns.
 * `post-status` owns none: it is the draft flag the write is given.
 * `p3k-content-type` and `visibility` own none either: they are checked as a
 * create checks them and change nothing. Anything
 * else, `mp-slug` included, is refused by name, so a post's URL only moves
 * when its author moves it in the editor.
 */
const UPDATABLE: Readonly<Record<string, readonly (keyof EditorForm)[]>> = {
  name: ['title'],
  content: ['body'],
  summary: ['description'],
  category: ['tags'],
  'in-reply-to': ['inReplyTo'],
  'repost-of': ['repostOf'],
  'like-of': ['likeOf'],
  'bookmark-of': ['bookmarkOf'],
  published: ['date'],
  'post-status': [],
  'p3k-content-type': [],
  visibility: [],
  photo: ['photos'],
  'mp-syndicate-to': ['syndicateTo'],
};

/**
 * A post's properties as `q=source` answers them: the create mapping
 * (decision-27) read backwards, so a client can send them back as they came.
 * A property the post does not have is left out. `mp-syndicate-to` holds
 * only the targets the site declares, the ones a client can offer; an id the
 * file lists that names none stays in the file, as it does through an editor
 * save.
 */
export function sourceProperties(
  document: Document,
  site: Pick<CreateSite, 'baseUrl' | 'targets'>,
): Record<string, unknown[]> {
  const { baseUrl } = site;
  const properties: Record<string, unknown[]> = {};
  const text = (name: string, value: string | undefined): void => {
    if (value !== undefined && value !== '') properties[name] = [value];
  };
  text('name', document.title);
  text('content', document.body.trim());
  text('summary', document.description);
  if (document.tags.length > 0) properties['category'] = [...document.tags];
  text('in-reply-to', document.inReplyTo);
  for (const { property, url } of citationsOf(document.extra)) text(property, url);
  text('published', document.date);
  properties['post-status'] = [document.draft ? 'draft' : 'published'];
  const photos = photoRows(document).map(({ url, alt }) => {
    const value = url.startsWith('/') ? absoluteUrl(url, baseUrl) : url;
    return alt === '' ? value : { value, alt };
  });
  if (photos.length > 0) properties['photo'] = photos;
  const declared = new Set(site.targets.map(({ id }) => id));
  const selected = syndicateToOf(document.extra).filter((id) => declared.has(id));
  if (selected.length > 0) properties['mp-syndicate-to'] = selected;
  return properties;
}

/**
 * One change an update asks for. A `delete` without values takes the whole
 * property away.
 */
export type Change =
  | {
      readonly op: 'replace' | 'add';
      readonly property: string;
      readonly values: readonly unknown[];
    }
  | {
      readonly op: 'delete';
      readonly property: string;
      readonly values: readonly unknown[] | undefined;
    };

/**
 * The `replace`, `add` and `delete` of a JSON update as {@link Change}s, in
 * that order, or what is wrong with them.
 */
export function parseChanges(
  body: Readonly<Record<string, unknown>>,
): readonly Change[] | { readonly error: string } {
  const changes: Change[] = [];
  for (const op of ['replace', 'add', 'delete'] as const) {
    const given = body[op];
    if (given === undefined) continue;
    if (op === 'delete' && Array.isArray(given)) {
      if (!given.every((name) => typeof name === 'string')) {
        return { error: 'delete lists property names.' };
      }
      changes.push(...given.map((property: string) => ({ op, property, values: undefined })));
      continue;
    }
    if (typeof given !== 'object' || given === null || Array.isArray(given)) {
      return { error: `${op} is an object of properties, each a list of values.` };
    }
    for (const [property, values] of Object.entries(given)) {
      if (!Array.isArray(values)) return { error: `${op} ${property} is not a list of values.` };
      changes.push({ op, property, values });
    }
  }
  return changes;
}

/**
 * The editor form an update leaves the post with: the form the editor would
 * load, with only the fields the changed properties own taken from the create
 * mapping (decision-27), so whatever Micropub cannot see stays as it is.
 */
export function updateForm(
  document: Document,
  given: readonly Change[],
  site: Omit<CreateSite, 'author'>,
): { readonly form: EditorForm; readonly draft: boolean } | { readonly errors: string[] } {
  const changes = given.map((change) => ({ ...change, property: propertyName(change.property) }));
  const touched = [...new Set(changes.map(({ property }) => property))];
  const unknown = touched.filter((property) => !(property in UPDATABLE));
  if (unknown.length > 0) return { errors: [`This endpoint cannot update ${unknown.join(', ')}.`] };

  const source = sourceProperties(document, site);
  const properties = new Map(touched.map((property) => [property, source[property] ?? []]));
  for (const change of changes) {
    const current = properties.get(change.property) ?? [];
    properties.set(change.property, changed(current, change));
  }

  const created = createForm(
    { type: 'h-entry', properties },
    { ...site, author: document.author ?? '' },
  );
  if ('errors' in created) return created;

  const form = formFor(document, site.timezone);
  for (const property of touched) {
    for (const field of UPDATABLE[property] ?? []) {
      Object.assign(form, { [field]: created.form[field] });
    }
  }
  return { form, draft: properties.has('post-status') ? created.draft : document.draft };
}

function changed(current: readonly unknown[], change: Change): unknown[] {
  switch (change.op) {
    case 'replace':
      return [...change.values];
    case 'add':
      return [...current, ...change.values];
    case 'delete': {
      if (change.values === undefined) return [];
      const gone = new Set(change.values.map((value) => JSON.stringify(value)));
      return current.filter((value) => !gone.has(JSON.stringify(value)));
    }
  }
}
