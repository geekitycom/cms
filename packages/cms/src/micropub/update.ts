import { formFor } from '../admin/documents.ts';
import type { EditorForm } from '../admin/documents.ts';
import { eventFrontMatter } from '../admin/event-field.ts';
import { photoRows } from '../admin/photo-field.ts';
import { citationsOf } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { eventOf } from '../content/event.ts';
import { locationToMicropub } from '../content/location.ts';
import { readOf } from '../content/read.ts';
import type { ReadOf } from '../content/read.ts';
import { rsvpOf } from '../content/rsvp.ts';
import type { KeptProperties } from '../content/kept-properties.ts';
import type { PostLocations } from '../content/locations.ts';
import type { PermalinkFile } from '../content/permalink-file.ts';
import { visibilityOf } from '../content/visibility.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import { syndicateToOf } from '../webmention/syndication.ts';
import { createForm, keptPrivately, keptRefusal, propertyName } from './create.ts';
import type { CreateSite } from './create.ts';

/**
 * The properties an update may change, and the editor fields each one owns.
 * `post-status` owns none: it is the draft flag the write is given. Anything
 * else, `mp-slug` included, is refused by name, so a post's URL only moves
 * when its author moves it in the editor.
 */
const UPDATABLE: Readonly<Record<string, readonly (keyof EditorForm)[]>> = {
  name: ['title'],
  content: ['body'],
  summary: ['description'],
  category: ['tags'],
  'in-reply-to': ['inReplyTo'],
  rsvp: ['rsvp'],
  'repost-of': ['repostOf'],
  'like-of': ['likeOf'],
  'bookmark-of': ['bookmarkOf'],
  'read-of': ['readOf'],
  'read-status': ['readStatus'],
  published: ['date'],
  'post-status': [],
  'p3k-content-type': [],
  visibility: ['visibility'],
  photo: ['photos'],
  location: ['location'],
  checkin: ['location'],
  'mp-syndicate-to': ['syndicateTo'],
  start: ['event'],
  end: ['event'],
};

/** On an event, `location` is the event's place, not the author's own (decision-32). */
const EVENT_UPDATABLE: typeof UPDATABLE = { ...UPDATABLE, location: ['event'] };

const EVENT_PROPERTIES = ['start', 'end', 'location'] as const;

/** The microformats type a post is read back and updated as. */
export function micropubType(document: Document): 'h-entry' | 'h-event' {
  return eventOf(document.extra) === undefined ? 'h-entry' : 'h-event';
}

export interface SourceSite extends Pick<CreateSite, 'baseUrl' | 'targets'> {
  readonly locations: PostLocations;
  readonly kept: PermalinkFile<KeptProperties>;
}

/**
 * A post's properties as `q=source` answers them: the create mapping
 * (decision-27) read backwards, so a client can send them back as they came.
 * A property the post does not have is left out. `mp-syndicate-to` holds
 * only the targets the site declares, the ones a client can offer; an id the
 * file lists that names none stays in the file, as it does through an editor
 * save.
 */
export function sourceProperties(document: Document, site: SourceSite): Record<string, unknown[]> {
  const { baseUrl } = site;
  const properties: Record<string, unknown[]> = {};
  const text = (name: string, value: string | undefined): void => {
    if (value !== undefined && value !== '') properties[name] = [value];
  };
  text('name', document.title);
  const event = eventOf(document.extra);
  if (event !== undefined) {
    for (const [name, value] of Object.entries(eventFrontMatter(event))) text(name, value);
  }
  text('content', document.body.trim());
  text('summary', document.description);
  if (document.tags.length > 0) properties['category'] = [...document.tags];
  text('in-reply-to', document.inReplyTo);
  text('rsvp', rsvpOf(document.extra));
  for (const { property, url } of citationsOf(document.extra)) text(property, url);
  const read = readOf(document.extra);
  if (read !== undefined) {
    properties['read-of'] = [readCite(read.of)];
    properties['read-status'] = [read.status];
  }
  text('published', document.date);
  properties['post-status'] = [document.draft ? 'draft' : 'published'];
  const visibility = visibilityOf(document);
  properties['visibility'] = [
    typeof visibility === 'string' ? visibility : visibility.unrecognized,
  ];
  const photos = photoRows(document).map(({ url, alt }) => {
    const value = url.startsWith('/') ? absoluteUrl(url, baseUrl) : url;
    return alt === '' ? value : { value, alt };
  });
  if (photos.length > 0) properties['photo'] = photos;
  const authorLocation = site.locations.read(document.permalink);
  if (authorLocation !== undefined && (event === undefined || authorLocation.checkin === true)) {
    properties[authorLocation.checkin === true ? 'checkin' : 'location'] = [
      locationToMicropub(authorLocation),
    ];
  }
  const declared = new Set(site.targets.map(({ id }) => id));
  const selected = syndicateToOf(document.extra).filter((id) => declared.has(id));
  if (selected.length > 0) properties['mp-syndicate-to'] = selected;
  for (const [name, values] of stillUnmapped(site.kept.read(document.permalink) ?? {})) {
    properties[name] = [...values];
  }
  return properties;
}

function stillUnmapped(kept: KeptProperties): [string, KeptProperties[string]][] {
  return Object.entries(kept).filter(([name]) => keptPrivately(name));
}

function readCite(of: ReadOf): object {
  const fields = Object.entries(of).filter(([, value]) => value !== undefined);
  return {
    type: ['h-cite'],
    properties: Object.fromEntries(fields.map(([name, value]) => [name, [value]])),
  };
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
):
  | {
      readonly form: EditorForm;
      readonly draft: boolean;
      readonly keptProperties: KeptProperties | undefined;
    }
  | { readonly errors: string[] } {
  const changes = given.map((change) => ({ ...change, property: propertyName(change.property) }));
  const touched = [...new Set(changes.map(({ property }) => property))];
  const unknown = touched.filter(
    (property) => !(property in UPDATABLE) && !keptPrivately(property),
  );
  if (unknown.length > 0) return { errors: [`This endpoint cannot update ${unknown.join(', ')}.`] };

  const type = micropubType(document);
  const updatable = type === 'h-event' ? EVENT_UPDATABLE : UPDATABLE;
  // An event's start, end and place fill one editor field, so each is read
  // whichever one changes, and the ones left alone are written back as they were.
  const sourced = type === 'h-event' ? [...new Set([...touched, ...EVENT_PROPERTIES])] : touched;
  const source = sourceProperties(document, site);
  const properties = new Map(sourced.map((property) => [property, source[property] ?? []]));
  for (const change of changes) {
    const current = properties.get(change.property) ?? [];
    properties.set(change.property, changed(current, change));
  }

  const mapped = new Map([...properties].filter(([name]) => !keptPrivately(name)));
  const created = createForm(
    { type, properties: mapped },
    { ...site, author: document.author ?? '' },
  );
  if ('errors' in created) return created;

  let keptProperties: KeptProperties | undefined;
  if (touched.some(keptPrivately)) {
    const all = { ...source, ...Object.fromEntries(properties) };
    keptProperties = Object.fromEntries(
      Object.entries(all).filter(([name, values]) => keptPrivately(name) && values.length > 0),
    );
    const refused = keptRefusal(keptProperties);
    if (refused !== undefined) return { errors: [refused] };
  }

  const form = formFor(document, site.timezone, site.locations.read(document.permalink));
  for (const property of touched) {
    for (const field of updatable[property] ?? []) {
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
