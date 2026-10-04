import { blankForm, POST_KIND } from '../admin/documents.ts';
import type { EditorForm } from '../admin/documents.ts';
import { locationForm } from '../admin/location-field.ts';
import type { PhotoRow } from '../admin/photo-field.ts';
import { BLANK_READ_OF_FORM } from '../admin/read-field.ts';
import type { ReadOfForm } from '../admin/read-field.ts';
import { isWebUrl } from '../content/enclosure.ts';
import type { KeptProperties } from '../content/kept-properties.ts';
import { checkinFromMicropub, locationFromMicropub, postLocation } from '../content/location.ts';
import type { PostLocation } from '../content/location.ts';
import { isReadStatus, READ_STATUSES } from '../content/read.ts';
import { isVisibility } from '../content/visibility.ts';
import { normalizeBody } from '../content/writer.ts';
import { UPLOAD_ASSET_PREFIX } from '../web/assets.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import type { SyndicationTarget } from '../webmention/syndication.ts';
import { cleanMarkdown, markdownFromHtml } from './content.ts';

/**
 * A Micropub create (TASK-164), whichever way it was encoded: the one
 * microformats2 type it names and each property's values.
 */
export interface CreateRequest {
  /** The `h-*` type, as JSON spells it: `h-entry` for a form's `h=entry`. */
  readonly type: string;
  readonly properties: ReadonlyMap<string, readonly unknown[]>;
}

/** Content as HTML, which a JSON client sends as `{ "html": "…" }`. */
interface HtmlContent {
  readonly html: string;
}

/**
 * The properties a post can be created with, and the editor field each one
 * fills (decision-27). Anything else is kept privately, as it was sent, except
 * an `mp-*` command the site does not carry out, which is refused by name.
 */
const SINGLE_VALUED = {
  name: 'title',
  summary: 'description',
  'in-reply-to': 'inReplyTo',
  'repost-of': 'repostOf',
  'like-of': 'likeOf',
  'bookmark-of': 'bookmarkOf',
  published: 'date',
  'mp-slug': 'slug',
} as const satisfies Record<string, keyof EditorForm>;

const ACCEPTED_WITHOUT_EFFECT = {
  'p3k-content-type': (type: string) =>
    type === 'text/plain' || type === 'text/markdown'
      ? undefined
      : `p3k-content-type is text/plain or text/markdown, not ${type}.`,
} as const satisfies Readonly<Record<string, (value: string) => string | undefined>>;

const MAPPED_ON_THEIR_OWN = [
  'content',
  'category',
  'photo',
  'location',
  'checkin',
  'post-status',
  'mp-syndicate-to',
  'visibility',
  'read-of',
  'read-status',
] as const;

export type Property =
  | keyof typeof SINGLE_VALUED
  | keyof typeof ACCEPTED_WITHOUT_EFFECT
  | (typeof MAPPED_ON_THEIR_OWN)[number];

const PROPERTIES = new Set<string>([
  ...Object.keys(SINGLE_VALUED),
  ...Object.keys(ACCEPTED_WITHOUT_EFFECT),
  ...MAPPED_ON_THEIR_OWN,
]);

/**
 * The names Quill accounts created before its migrations 0002 and 0004 send,
 * and the property each one is.
 */
const LEGACY_NAMES: ReadonlyMap<string, string> = new Map([
  ['slug', 'mp-slug'],
  ['syndicate-to', 'mp-syndicate-to'],
]);

export function propertyName(name: string): string {
  return LEGACY_NAMES.get(name) ?? name;
}

export function keptPrivately(name: string): boolean {
  return !PROPERTIES.has(name) && !name.startsWith('mp-');
}

const KEPT_PROPERTIES_LIMIT_BYTES = 16 * 1024;

export function keptRefusal(kept: KeptProperties): string | undefined {
  const names = Object.keys(kept);
  const files = Object.entries(kept)
    .filter(([, values]) => values.some((value) => value instanceof File))
    .map(([name]) => name);
  if (files.length > 0) {
    return `${files.join(', ')} is not understood here and is not a photo, so a file cannot be sent as it.`;
  }
  const size = Buffer.byteLength(JSON.stringify(kept));
  if (size > KEPT_PROPERTIES_LIMIT_BYTES) {
    return `This endpoint keeps up to ${String(KEPT_PROPERTIES_LIMIT_BYTES / 1024)} KiB of properties it does not understand on a post, and ${names.join(', ')} come to ${String(Math.ceil(size / 1024))} KiB.`;
  }
  return undefined;
}

const PUBLISHABLE: readonly Property[] = [
  'content',
  'name',
  'photo',
  'in-reply-to',
  'like-of',
  'repost-of',
  'bookmark-of',
  'read-of',
  'checkin',
];

/** What `post-status` may say, and whether it makes a draft. */
const POST_STATUSES: Readonly<Record<string, boolean>> = { published: false, draft: true };

/** The form fields Micropub sets aside from the post's own properties. */
const FORM_RESERVED = new Set(['h', 'access_token']);

/**
 * A form-encoded or multipart create as a {@link CreateRequest}: `h=entry`
 * names the type, and `category[]=a&category[]=b` and `category=a&category=b`
 * are the same two values.
 */
export function fromForm(form: FormData): CreateRequest {
  const properties = new Map<string, unknown[]>();
  for (const [key, value] of form.entries()) {
    if (FORM_RESERVED.has(key)) continue;
    const name = key.endsWith('[]') ? key.slice(0, -2) : key;
    properties.set(name, [...(properties.get(name) ?? []), value]);
  }
  const h = form.get('h');
  return { type: typeof h === 'string' && h !== '' ? `h-${h}` : '', properties };
}

/** A JSON create as a {@link CreateRequest}, or what is wrong with it. */
export function fromJson(body: unknown): CreateRequest | { readonly error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'A JSON request is an object with type and properties.' };
  }
  const { type, properties } = body as Record<string, unknown>;
  if (!Array.isArray(type) || type.length !== 1 || typeof type[0] !== 'string') {
    return { error: 'A JSON request names exactly one type, such as ["h-entry"].' };
  }
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return { error: 'A JSON request carries its properties in an object.' };
  }
  const entries = Object.entries(properties as Record<string, unknown>);
  const notLists = entries.filter(([, values]) => !Array.isArray(values)).map(([name]) => name);
  if (notLists.length > 0) {
    return { error: `Every property is a list of values; ${notLists.join(', ')} is not.` };
  }
  return { type: type[0], properties: new Map(entries as [string, unknown[]][]) };
}

/** A photo sent as a file part of a multipart create, for the editor row it fills. */
export interface PhotoUpload {
  /** The index of its row in the form's photos, whose address is empty until it is stored. */
  readonly row: number;
  readonly file: File;
}

/**
 * Who a create is by and the site it lands on: its zone and clock, its base
 * URL, whose own uploads are written as paths, and the syndication targets it
 * declares, which are all `mp-syndicate-to` may name.
 */
export interface CreateSite {
  readonly author: string;
  readonly timezone: string;
  readonly now: Date;
  readonly baseUrl: string;
  readonly targets: readonly SyndicationTarget[];
}

/** A create that can be written, once its {@link PhotoUpload}s are stored. */
export interface CreatedForm {
  readonly form: EditorForm;
  readonly draft: boolean;
  readonly uploads: readonly PhotoUpload[];
  readonly keptProperties: KeptProperties;
}

/**
 * The editor form a create fills in, or every reason it cannot be, each
 * naming the type or property at fault.
 *
 * The form then goes through the editor's own write path, which is what makes
 * a Micropub post indistinguishable from an editor post (AC #2).
 */
export function createForm(
  request: CreateRequest,
  site: CreateSite,
): CreatedForm | { readonly errors: string[] } {
  const { author, timezone, now } = site;
  if (request.type !== 'h-entry') {
    const named = request.type === '' ? 'no type' : request.type;
    return { errors: [`This endpoint creates h-entry posts, not ${named}.`] };
  }

  const properties = new Map<string, readonly unknown[]>();
  for (const [name, values] of request.properties) {
    const property = propertyName(name);
    properties.set(property, [...(properties.get(property) ?? []), ...values]);
  }

  const errors: string[] = [];
  const commands = [...properties.keys()].filter(
    (name) => name.startsWith('mp-') && !PROPERTIES.has(name),
  );
  if (commands.length > 0) {
    errors.push(`This endpoint does not support ${commands.join(', ')}.`);
  }
  const keptProperties = Object.fromEntries(
    [...properties].filter(([name, values]) => keptPrivately(name) && values.length > 0),
  );
  const kept = Object.keys(keptProperties);
  const refused = keptRefusal(keptProperties);
  if (refused !== undefined) errors.push(refused);
  if (kept.length > 0 && !PUBLISHABLE.some((name) => (properties.get(name) ?? []).length > 0)) {
    errors.push(
      `This endpoint does not understand ${kept.join(', ')}, and the post has nothing else to publish.`,
    );
  }

  const text = (name: string): string => {
    const values = properties.get(name) ?? [];
    if (values.length > 1) errors.push(`${name} takes one value.`);
    const [value] = values;
    if (value === undefined) return '';
    if (typeof value !== 'string') {
      errors.push(`${name} has to be text.`);
      return '';
    }
    return value.trim();
  };

  const form: EditorForm = {
    ...blankForm(POST_KIND, timezone, now),
    date: '',
    author,
    body: normalizeBody(content(properties.get('content') ?? [], errors)),
    tags: categories(properties.get('category') ?? [], errors),
    syndicateTo: syndicateTo(properties.get('mp-syndicate-to') ?? [], site.targets, errors),
  };
  const uploads: PhotoUpload[] = [];
  form.photos = (properties.get('photo') ?? []).map((value, row) => {
    if (value instanceof File) {
      uploads.push({ row, file: value });
      return { url: '', alt: '' };
    }
    const photo = photoRow(value, site.baseUrl);
    if (photo === undefined) {
      errors.push('photo is a web address, { "value": "…", "alt": "…" } or an uploaded file.');
      return { url: '', alt: '' };
    }
    return photo;
  });
  form.location = locationForm(
    checkinOverLocation(
      parsedLocation('location', properties.get('location') ?? [], locationFromMicropub, errors),
      parsedLocation('checkin', properties.get('checkin') ?? [], checkinFromMicropub, errors),
    ),
  );
  form.readOf = readOf(properties.get('read-of') ?? [], errors);
  form.readStatus = text('read-status');
  if (form.readStatus !== '' && !isReadStatus(form.readStatus)) {
    errors.push(`read-status is ${READ_STATUSES.join(', ')}, not ${form.readStatus}.`);
  }
  for (const [property, field] of Object.entries(SINGLE_VALUED)) {
    form[field] = text(property);
  }
  const sentVisibility = text('visibility');
  const visibility = sentVisibility.toLowerCase();
  if (isVisibility(visibility)) form.visibility = visibility;
  else if (visibility === 'private') {
    errors.push('This site does not publish private posts; visibility is public or unlisted.');
  } else if (visibility !== '') {
    errors.push(`visibility is public or unlisted, not ${sentVisibility}.`);
  }
  for (const [property, refused] of Object.entries(ACCEPTED_WITHOUT_EFFECT)) {
    const value = text(property);
    const reason = value === '' ? undefined : refused(value);
    if (reason !== undefined) errors.push(reason);
  }

  const status = text('post-status');
  const draft = status === '' ? false : POST_STATUSES[status];
  if (draft === undefined) {
    errors.push(`post-status is published or draft, not ${status}.`);
  }

  return errors.length > 0 || draft === undefined
    ? { errors }
    : { form, draft, uploads, keptProperties };
}

/**
 * A photo given as a URL or as `{ value, alt }`, as the editor row it fills.
 * A URL into this site's own uploads becomes the path the editor would have
 * written, so the theme serves its responsive variants.
 */
function photoRow(value: unknown, baseUrl: string): PhotoRow | undefined {
  let url: unknown = value;
  let alt: unknown = '';
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    ({ value: url, alt = '' } = value as Record<string, unknown>);
  }
  if (typeof url !== 'string' || typeof alt !== 'string' || !isWebUrl(url.trim())) return undefined;
  const uploads = absoluteUrl(UPLOAD_ASSET_PREFIX, baseUrl);
  const address = url.trim();
  return {
    url: address.startsWith(uploads)
      ? `${UPLOAD_ASSET_PREFIX}${address.slice(uploads.length)}`
      : address,
    alt: alt.trim(),
  };
}

function parsedLocation(
  name: string,
  values: readonly unknown[],
  parse: (value: unknown) => PostLocation | { readonly error: string },
  errors: string[],
): PostLocation | undefined {
  if (values.length > 1) errors.push(`${name} takes one value.`);
  const [value] = values;
  if (value === undefined) return undefined;
  const parsed = parse(value);
  if ('error' in parsed) {
    errors.push(parsed.error);
    return undefined;
  }
  return parsed;
}

function checkinOverLocation(
  location: PostLocation | undefined,
  checkin: PostLocation | undefined,
): PostLocation | undefined {
  if (location === undefined || checkin === undefined) return checkin ?? location;
  return postLocation({ ...location, ...checkin, geo: checkin.geo ?? location.geo });
}

const READ_OF_PROPERTIES = ['name', 'author', 'uid', 'url'] as const;

function readOf(values: readonly unknown[], errors: string[]): ReadOfForm {
  if (values.length > 1) errors.push('read-of takes one value.');
  const [value] = values;
  if (value === undefined) return BLANK_READ_OF_FORM;
  const { type, properties } =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  if (
    !Array.isArray(type) ||
    !type.includes('h-cite') ||
    typeof properties !== 'object' ||
    properties === null
  ) {
    errors.push('read-of is an h-cite, { "type": ["h-cite"], "properties": { "name": ["…"] } }.');
    return BLANK_READ_OF_FORM;
  }
  const given = properties as Record<string, unknown>;
  const unknown = Object.keys(given).filter(
    (name) => !(READ_OF_PROPERTIES as readonly string[]).includes(name),
  );
  if (unknown.length > 0) errors.push(`read-of does not understand ${unknown.join(', ')}.`);
  const field = (name: (typeof READ_OF_PROPERTIES)[number]): string => {
    const values = given[name] ?? [];
    if (
      !Array.isArray(values) ||
      values.length > 1 ||
      !values.every((v) => typeof v === 'string')
    ) {
      errors.push(`read-of ${name} takes one text value.`);
      return '';
    }
    return (values[0] ?? '').trim();
  };
  return { name: field('name'), author: field('author'), uid: field('uid'), url: field('url') };
}

/**
 * The body: text as the Markdown it is written in and HTML as Markdown, each
 * with its raw HTML cleaned (TASK-258).
 */
function content(values: readonly unknown[], errors: string[]): string {
  if (values.length > 1) errors.push('content takes one value.');
  const [value] = values;
  if (value === undefined) return '';
  if (typeof value !== 'string' && !isHtmlContent(value)) {
    errors.push('content has to be text or { "html": "…" }.');
    return '';
  }
  const body = typeof value === 'string' ? cleanMarkdown(value) : markdownFromHtml(value.html);
  if (body === undefined) errors.push('content has HTML the site cannot clean.');
  return body ?? '';
}

function isHtmlContent(value: unknown): value is HtmlContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['html'] === 'string'
  );
}

/** The categories as the editor's comma-separated tags field. */
function categories(values: readonly unknown[], errors: string[]): string {
  const terms: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.includes(',')) {
      errors.push('category has to be text, one tag to a value, without commas.');
      return '';
    }
    terms.push(value);
  }
  return terms.join(', ');
}

/**
 * The targets `mp-syndicate-to` selects, each once, as the editor's checkboxes
 * would. A uid the site does not declare is refused by name: a post read back
 * ignores it, so a client would never learn the post went nowhere.
 */
function syndicateTo(
  values: readonly unknown[],
  targets: readonly SyndicationTarget[],
  errors: string[],
): string[] {
  if (!values.every((value) => typeof value === 'string')) {
    errors.push('mp-syndicate-to has to be text, one target uid to a value.');
    return [];
  }
  const declared = new Set(targets.map(({ id }) => id));
  const unknown = values.filter((uid) => !declared.has(uid));
  if (unknown.length > 0) {
    errors.push(`mp-syndicate-to names no syndication target ${unknown.join(', ')}.`);
  }
  return [...new Set(values)];
}
