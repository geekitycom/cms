import type { Document } from '../content/document.ts';
import { formFor } from '../content/document-form.ts';
import type { EditorForm } from '../content/document-form.ts';
import { POST_KIND } from '../content/document-kind.ts';
import type { DocumentKind } from '../content/document-kind.ts';
import { eventOf } from '../content/event.ts';
import { reviewOf } from '../content/review.ts';
import type { KeptProperties } from '../content/kept-properties.ts';
import { locationToMicropub } from '../content/location.ts';
import type { PostLocations } from '../content/locations.ts';
import type { PermalinkFile } from '../content/permalink-file.ts';
import type { MicropubSite, MicropubType } from '../content/post-fields.ts';
import { visibilityOf } from '../content/visibility.ts';
import { createForm, keptPrivately, keptRefusal, propertyName } from './create.ts';
import type { CreateSite } from './create.ts';

type Updatable = Readonly<Record<string, readonly (keyof EditorForm)[]>>;

const CORE_UPDATABLE: Updatable = {
  name: ['title'],
  content: ['body'],
  summary: ['description'],
  category: ['tags'],
  'in-reply-to': ['inReplyTo'],
  published: ['date'],
  'post-status': [],
  'p3k-content-type': [],
  visibility: ['visibility'],
  location: ['location'],
  checkin: ['location'],
};

function updatable(kind: DocumentKind, type: MicropubType): Updatable {
  return {
    ...CORE_UPDATABLE,
    ...Object.fromEntries(
      kind.fields.flatMap((field) => Object.entries(field.micropub?.properties ?? {})),
    ),
    ...(type === 'h-event' ? { location: ['event'] } : {}),
  };
}

/**
 * The properties an h-event or an h-review cannot be read without, which an
 * update to any one property of it sources too.
 */
function typeProperties(kind: DocumentKind, type: MicropubType): string[] {
  const field = type === 'h-event' ? 'event' : type === 'h-review' ? 'review' : undefined;
  if (field === undefined) return [];
  return Object.entries(updatable(kind, type))
    .filter(([, fields]) => fields.includes(field))
    .map(([property]) => property);
}

export function micropubType(document: Document): MicropubType {
  if (eventOf(document.extra) !== undefined) return 'h-event';
  return reviewOf(document.extra) === undefined ? 'h-entry' : 'h-review';
}

export interface SourceSite extends MicropubSite {
  readonly locations: PostLocations;
  readonly kept: PermalinkFile<KeptProperties>;
}

export function sourceProperties(
  document: Document,
  site: SourceSite,
  kind: DocumentKind = POST_KIND,
): Record<string, unknown[]> {
  const properties: Record<string, unknown[]> = {};
  const text = (name: string, value: string | undefined): void => {
    if (value !== undefined && value !== '') properties[name] = [value];
  };
  text('name', document.title);
  text('content', document.body.trim());
  text('summary', document.description);
  if (document.tags.length > 0) properties['category'] = [...document.tags];
  text('in-reply-to', document.inReplyTo);
  text('published', document.date);
  properties['post-status'] = [document.draft ? 'draft' : 'published'];
  const visibility = visibilityOf(document);
  properties['visibility'] = [
    typeof visibility === 'string' ? visibility : visibility.unrecognized,
  ];
  for (const field of kind.fields) {
    Object.assign(properties, field.micropub?.toProperties(document, site));
  }
  const authorLocation = site.locations.read(document.permalink);
  if (
    authorLocation !== undefined &&
    (micropubType(document) !== 'h-event' || authorLocation.checkin === true)
  ) {
    properties[authorLocation.checkin === true ? 'checkin' : 'location'] = [
      locationToMicropub(authorLocation),
    ];
  }
  for (const [name, values] of Object.entries(site.kept.read(document.permalink) ?? {})) {
    if (keptPrivately(name, kind)) properties[name] = [...values];
  }
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
 * mapping (decision-27), so whatever Micropub cannot see stays as it is. A
 * change to a property the site does not understand changes what it keeps of
 * the post, and an update that names none leaves that alone.
 */
export function updateForm(
  document: Document,
  given: readonly Change[],
  site: Omit<CreateSite, 'author'> & SourceSite,
  kind: DocumentKind = POST_KIND,
):
  | {
      readonly form: EditorForm;
      readonly draft: boolean;
      readonly keptProperties: KeptProperties | undefined;
    }
  | { readonly errors: string[] } {
  const kept = (name: string): boolean => keptPrivately(name, kind);
  const changes = given.map((change) => ({ ...change, property: propertyName(change.property) }));
  const touched = [...new Set(changes.map(({ property }) => property))];
  const type = micropubType(document);
  const owned = updatable(kind, type);
  const unknown = touched.filter((property) => !(property in owned) && !kept(property));
  if (unknown.length > 0) return { errors: [`This endpoint cannot update ${unknown.join(', ')}.`] };

  const sourced = [...new Set([...touched, ...typeProperties(kind, type)])];
  const source = sourceProperties(document, site, kind);
  const properties = new Map(sourced.map((property) => [property, source[property] ?? []]));
  for (const change of changes) {
    const current = properties.get(change.property) ?? [];
    properties.set(change.property, changed(current, change));
  }

  const mapped = new Map([...properties].filter(([name]) => !kept(name)));
  const created = createForm(
    { type, properties: mapped },
    { ...site, author: document.author ?? '' },
    kind,
  );
  if ('errors' in created) return created;

  let keptProperties: KeptProperties | undefined;
  if (touched.some(kept)) {
    const all = { ...source, ...Object.fromEntries(properties) };
    keptProperties = Object.fromEntries(
      Object.entries(all).filter(([name, values]) => kept(name) && values.length > 0),
    );
    const refused = keptRefusal(keptProperties);
    if (refused !== undefined) return { errors: [refused] };
  }

  const form = formFor(kind, document, site.timezone, site.locations.read(document.permalink));
  for (const property of touched) {
    for (const field of owned[property] ?? []) {
      Object.assign(form, { [field]: created.form[field] });
    }
  }
  return {
    form,
    draft: properties.has('post-status') ? created.draft : document.draft,
    keptProperties,
  };
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
