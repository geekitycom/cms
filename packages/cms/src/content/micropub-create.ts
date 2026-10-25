import { blankForm } from './document-form.ts';
import type { EditorForm } from './document-form.ts';
import { POST_KIND } from './document-kind.ts';
import type { DocumentKind } from './document-kind.ts';
import type { KeptProperties } from './kept-properties.ts';
import { checkinFromMicropub, locationFromMicropub, postLocation } from './location.ts';
import type { PostLocation } from './location.ts';
import { locationForm } from './location-form.ts';
import type { MicropubRequest, MicropubType } from './post-fields.ts';
import { isVisibility } from './visibility.ts';
import { normalizeBody } from './writer.ts';
import type { SyndicationTarget } from './syndicate-to.ts';
import { cleanMarkdown, markdownFromHtml } from './html-to-markdown.ts';

/**
 * A Micropub create, whichever way it was encoded: the one
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

const SINGLE_VALUED = {
  name: 'title',
  summary: 'description',
  'in-reply-to': 'inReplyTo',
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
  'location',
  'checkin',
  'post-status',
  'visibility',
] as const;

export type Property =
  | keyof typeof SINGLE_VALUED
  | keyof typeof ACCEPTED_WITHOUT_EFFECT
  | (typeof MAPPED_ON_THEIR_OWN)[number]
  | 'rsvp'
  | 'repost-of'
  | 'like-of'
  | 'bookmark-of'
  | 'photo'
  | 'mp-syndicate-to'
  | 'start'
  | 'end'
  | 'item'
  | 'rating';

const CORE_PROPERTIES: readonly string[] = [
  ...Object.keys(SINGLE_VALUED),
  ...Object.keys(ACCEPTED_WITHOUT_EFFECT),
  ...MAPPED_ON_THEIR_OWN,
];

function mappedProperties(kind: DocumentKind): ReadonlySet<string> {
  return new Set([
    ...CORE_PROPERTIES,
    ...kind.fields.flatMap((field) => Object.keys(field.micropub?.properties ?? {})),
  ]);
}

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

export function keptPrivately(name: string, kind: DocumentKind = POST_KIND): boolean {
  return !mappedProperties(kind).has(name) && !name.startsWith('mp-');
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

const PUBLISHABLE: readonly Property[] = ['content', 'name', 'in-reply-to', 'checkin'];

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
  // Quill's event editor sends location, content and end unwrapped.
  const entries = Object.entries(properties as Record<string, unknown>).map(
    ([name, values]): [string, unknown[]] => [name, Array.isArray(values) ? values : [values]],
  );
  return { type: type[0], properties: new Map(entries) };
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
  kind: DocumentKind = POST_KIND,
): CreatedForm | { readonly errors: string[] } {
  const { author, timezone, now } = site;
  if (request.type !== 'h-entry' && request.type !== 'h-event' && request.type !== 'h-review') {
    const named = request.type === '' ? 'no type' : request.type;
    return {
      errors: [`This endpoint creates h-entry, h-event and h-review posts, not ${named}.`],
    };
  }
  const type: MicropubType = request.type;

  const properties = new Map<string, readonly unknown[]>();
  for (const [name, values] of request.properties) {
    const property = propertyName(name);
    properties.set(property, [...(properties.get(property) ?? []), ...values]);
  }

  const errors: string[] = [];
  const mapped = mappedProperties(kind);
  const commands = [...properties.keys()].filter(
    (name) => name.startsWith('mp-') && !mapped.has(name),
  );
  if (commands.length > 0) {
    errors.push(`This endpoint does not support ${commands.join(', ')}.`);
  }
  const keptProperties = Object.fromEntries(
    [...properties].filter(([name, values]) => keptPrivately(name, kind) && values.length > 0),
  );
  const kept = Object.keys(keptProperties);
  const refused = keptRefusal(keptProperties);
  if (refused !== undefined) errors.push(refused);
  const publishable = [
    ...PUBLISHABLE,
    ...kind.fields.flatMap((field) => field.micropub?.publishable ?? []),
  ];
  if (kept.length > 0 && !publishable.some((name) => (properties.get(name) ?? []).length > 0)) {
    errors.push(
      `This endpoint does not understand ${kept.join(', ')}, and the post has nothing else to publish.`,
    );
  }

  const values = (name: string): readonly unknown[] => properties.get(name) ?? [];
  const text = (name: string): string => {
    const given = values(name);
    if (given.length > 1) errors.push(`${name} takes one value.`);
    const [value] = given;
    if (value === undefined) return '';
    if (typeof value !== 'string') {
      errors.push(`${name} has to be text.`);
      return '';
    }
    return value.trim();
  };

  const form: EditorForm = {
    ...blankForm(kind, timezone, now),
    date: '',
    author,
    body: content(values('content'), errors),
    tags: categories(values('category'), errors),
  };
  const uploads: PhotoUpload[] = [];
  const fields: MicropubRequest = {
    type,
    has: (name) => properties.has(name),
    values,
    text,
    refuse: (message) => errors.push(message),
    upload: (row, file) => uploads.push({ row, file }),
    baseUrl: site.baseUrl,
    targets: site.targets,
  };
  for (const field of kind.fields) {
    if (field.micropub !== undefined) Object.assign(form, field.micropub.toForm(fields));
  }
  const checkin = parsedLocation('checkin', values('checkin'), checkinFromMicropub, errors);
  form.location = locationForm(
    type === 'h-event'
      ? checkin
      : checkinOverLocation(
          parsedLocation('location', values('location'), locationFromMicropub, errors),
          checkin,
        ),
  );
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

function content(values: readonly unknown[], errors: string[]): string {
  if (values.length > 1) errors.push('content takes one value.');
  const [value] = values;
  if (value === undefined) return '';
  if (typeof value !== 'string' && !isHtmlContent(value)) {
    errors.push('content has to be text or { "html": "…" }.');
    return '';
  }
  const cleaned = typeof value === 'string' ? cleanMarkdown(value) : markdownFromHtml(value.html);
  const body = cleaned === undefined ? undefined : normalizeBody(cleaned);
  if (body === undefined || cleanMarkdown(body) !== body) {
    errors.push('content has HTML the site cannot clean.');
    return '';
  }
  return body;
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
