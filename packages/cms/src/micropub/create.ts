import { blankForm, POST_KIND } from '../admin/documents.ts';
import type { EditorForm } from '../admin/documents.ts';
import { normalizeBody } from '../content/writer.ts';

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
  const { type, properties, action } = body as Record<string, unknown>;
  if (action !== undefined) {
    return { error: `This endpoint does not support action=${JSON.stringify(action)}.` };
  }
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

/**
 * The editor form a create fills in, authored by `author`, or every reason it
 * cannot be, each naming the type or property at fault.
 *
 * The form then goes through the editor's own write path, which is what makes
 * a Micropub post indistinguishable from an editor post (AC #2).
 */
export function createForm(
  request: CreateRequest,
  author: string,
  timezone: string,
  now: Date,
): { readonly form: EditorForm; readonly draft: boolean } | { readonly errors: string[] } {
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
  for (const [property, field] of Object.entries(SINGLE_VALUED)) {
    form[field] = text(property);
  }

  const status = text('post-status');
  const draft = status === '' ? false : POST_STATUSES[status];
  if (draft === undefined) {
    errors.push(`post-status is published or draft, not ${status}.`);
  }

  return errors.length > 0 || draft === undefined ? { errors } : { form, draft };
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
