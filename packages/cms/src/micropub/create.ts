import { blankForm, POST_KIND } from '../admin/documents.ts';
import type { EditorForm } from '../admin/documents.ts';
import type { PhotoRow } from '../admin/photo-field.ts';
import { isWebUrl } from '../content/enclosure.ts';
import { normalizeBody } from '../content/writer.ts';
import { UPLOAD_ASSET_PREFIX } from '../web/assets.ts';
import { absoluteUrl } from '../web/negotiate.ts';

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
 * fills (decision-27). Anything else is refused by name rather than dropped,
 * so a client can tell its user what did not land.
 */
const SINGLE_VALUED = {
  name: 'title',
  summary: 'description',
  'in-reply-to': 'inReplyTo',
  published: 'date',
  'mp-slug': 'slug',
} as const satisfies Record<string, keyof EditorForm>;

const PROPERTIES = new Set<string>([
  ...Object.keys(SINGLE_VALUED),
  'content',
  'category',
  'photo',
  'post-status',
]);

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
 * Who a create is by and the site it lands on: its zone and clock, and its
 * base URL, whose own uploads are written as paths.
 */
export interface CreateSite {
  readonly author: string;
  readonly timezone: string;
  readonly now: Date;
  readonly baseUrl: string;
}

/** A create that can be written, once its {@link PhotoUpload}s are stored. */
export interface CreatedForm {
  readonly form: EditorForm;
  readonly draft: boolean;
  readonly uploads: readonly PhotoUpload[];
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

  const errors: string[] = [];
  const unknown = [...request.properties.keys()].filter((name) => !PROPERTIES.has(name));
  if (unknown.length > 0) {
    errors.push(`This endpoint does not understand ${unknown.join(', ')}.`);
  }

  const text = (name: string): string => {
    const values = request.properties.get(name) ?? [];
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
    body: normalizeBody(content(request.properties.get('content') ?? [], errors)),
    tags: categories(request.properties.get('category') ?? [], errors),
  };
  const uploads: PhotoUpload[] = [];
  form.photos = (request.properties.get('photo') ?? []).map((value, row) => {
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
  for (const [property, field] of Object.entries(SINGLE_VALUED)) {
    form[field] = text(property);
  }

  const status = text('post-status');
  const draft = status === '' ? false : POST_STATUSES[status];
  if (draft === undefined) {
    errors.push(`post-status is published or draft, not ${status}.`);
  }

  return errors.length > 0 || draft === undefined ? { errors } : { form, draft, uploads };
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

/** The body: plain text as the Markdown it is written in, or HTML as it came. */
function content(values: readonly unknown[], errors: string[]): string {
  if (values.length > 1) errors.push('content takes one value.');
  const [value] = values;
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (isHtmlContent(value)) return value.html;
  errors.push('content has to be text or { "html": "…" }.');
  return '';
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
