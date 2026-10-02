/**
 * A short log of what apps sent to the IndieAuth and Micropub endpoints, and
 * what they were answered (TASK-221), so a site owner can see why a client
 * failed to sign in or to post without reading the client's source.
 *
 * One entry per request to the authorization endpoint (the request as it
 * reaches the consent screen, and the profile redemption), the token
 * endpoint, Micropub and its media endpoint. Each route records through one
 * middleware placed in front of it, which sees the final status and reads the
 * refusal out of the response itself: Micropub's and OAuth's JSON error
 * bodies, or the `error` on an authorization redirect. A handler adds only
 * what its response does not show, through {@link noteActivity}.
 *
 * Nothing secret is kept. No header is read, so no `Authorization` and no
 * cookie; a field named in {@link SECRET_FIELDS} is kept as its name alone,
 * at any depth of a JSON body; a file part is its name, type and size; and
 * every value is cut short. No client address is stored.
 *
 * The file is bounded by count and by age, private to the site's user, and
 * written after the response is decided without the response waiting on it:
 * a write that fails is a warning on the console, never a different answer.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { Context, MiddlewareHandler } from 'hono';

import { findUserById } from '../admin/accounts.ts';
import type { GeekityEnv } from '../env.ts';
import { readFileIfPresentSync, updateFileAtomically, withFileLock } from '../files/atomic.ts';
import type { Bearer } from './bearer.ts';

/** The log, relative to `dataDir`. */
export const ACTIVITY_LOG_FILE = 'indieauth-activity.json';

/** Readable and writable by the site's own user only, like the tokens beside it. */
export const ACTIVITY_LOG_MODE = 0o600;

/** How many entries are kept, newest first. */
export const ACTIVITY_LOG_LIMIT = 100;

/** How long an entry is kept: fourteen days. */
export const ACTIVITY_LOG_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** The longest value kept, in characters, before it is cut and marked with an ellipsis. */
const VALUE_LIMIT = 100;

/** The most fields one entry lists. */
const CARRIED_LIMIT = 40;

/** Fields whose value is never kept, only that they were sent. */
const SECRET_FIELDS: ReadonlySet<string> = new Set([
  'access_token',
  'refresh_token',
  'code',
  'code_verifier',
  'client_secret',
  'password',
  'cookie',
]);

/** One field a request carried, as the log keeps it. */
export type CarriedField =
  | { readonly name: string; readonly value: string }
  | {
      readonly name: string;
      readonly file: { readonly filename: string; readonly type: string; readonly size: number };
    }
  | { readonly name: string; readonly redacted: true };

/** Which endpoint a request went to. */
export type ActivityEndpoint = 'authorization' | 'token' | 'micropub' | 'media';

/** What a request's own route knows about it. */
interface Facts {
  /** The client's URL, when the request named one or its token did. */
  readonly clientId?: string | undefined;
  /** The username the request acted as, when that is known. */
  readonly user?: string | undefined;
  readonly carried: readonly CarriedField[];
}

/** An entry's endpoint-specific part, one variant per endpoint and action. */
export type EndpointFacts = Facts &
  (
    | {
        readonly endpoint: 'authorization';
        readonly action: 'request';
        /** Whether the request carried an S256 `code_challenge`. */
        readonly pkce: boolean;
        /** The scopes asked for, as asked, offered or not. */
        readonly scopes: readonly string[];
      }
    | { readonly endpoint: 'authorization'; readonly action: 'redeem' }
    | {
        readonly endpoint: 'token';
        /** The `grant_type`, `authorization_code` when the client left it out. */
        readonly action: string;
        /** The scopes the token was issued with, on success. */
        readonly scopes: readonly string[];
      }
    | {
        readonly endpoint: 'micropub' | 'media';
        /** The POST's action (`create` when none), `upload`, or the GET's `q=…`. */
        readonly action: string;
      }
  );

/** One request, as the log keeps it. */
export type ActivityEntry = EndpointFacts & {
  readonly id: string;
  /** When it arrived, as an ISO instant. */
  readonly at: string;
  readonly method: string;
  readonly status: number;
  /** The error code it was refused with. */
  readonly error?: string | undefined;
  readonly errorDescription?: string | undefined;
};

/**
 * What a handler adds to its entry that the response cannot show: a refusal
 * answered with an HTML page, and the user and scopes a token was issued for.
 */
export interface ActivityNote {
  readonly user?: string;
  readonly scopes?: readonly string[];
  readonly refusal?: { readonly error: string; readonly description: string };
}

/** Add to what this request's entry will say. */
export function noteActivity(c: Context<GeekityEnv>, note: ActivityNote): void {
  c.set('activityNote', { ...c.var.activityNote, ...note });
}

/** Whether an entry is a failure: refused with an error, or answered with an error status. */
export function isFailure(entry: ActivityEntry): boolean {
  return entry.error !== undefined || entry.status >= 400;
}

/** Whether an entry is still inside the age limit at `now`. */
export function isFresh(entry: ActivityEntry, now: Date): boolean {
  return now.getTime() - Date.parse(entry.at) <= ACTIVITY_LOG_MAX_AGE_MS;
}

function logFile(dataDir: string): string {
  return path.join(dataDir, ACTIVITY_LOG_FILE);
}

function parseLog(text: string | undefined): ActivityEntry[] {
  if (text === undefined) return [];
  try {
    const parsed = JSON.parse(text) as { entries?: unknown };
    return Array.isArray(parsed.entries) ? (parsed.entries as ActivityEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Every entry, newest first. Read in the file's queue, so a read follows the
 * writes queued before it and a screen shows the request that just finished.
 */
export async function readActivityLog(dataDir: string): Promise<ActivityEntry[]> {
  const file = logFile(dataDir);
  return await withFileLock(file, () => parseLog(readFileIfPresentSync(file)));
}

/** Settles once every entry already on its way to the file has landed, so closing never leaves one half written. */
export async function activityLogSettled(dataDir: string): Promise<void> {
  await withFileLock(logFile(dataDir), () => undefined);
}

async function appendEntry(dataDir: string, entry: ActivityEntry, now: Date): Promise<void> {
  await updateFileAtomically(
    logFile(dataDir),
    (current) => {
      const kept = parseLog(current).filter((old) => isFresh(old, now));
      const entries = [entry, ...kept].slice(0, ACTIVITY_LOG_LIMIT);
      return `${JSON.stringify({ entries }, null, 2)}\n`;
    },
    { mode: ACTIVITY_LOG_MODE },
  );
}

/** What a recording middleware may find on the context: a bearer, once the guard let it in. */
interface ActivityEnv {
  Variables: GeekityEnv['Variables'] & { bearer?: Bearer };
}

type Describe = (c: Context<ActivityEnv>) => Promise<EndpointFacts>;

/**
 * The middleware that records one entry per request to a route, after the
 * route has answered. A failure to describe or to write is a warning; the
 * write is not awaited, so the response never waits on the disk.
 */
function recordActivity(describe: Describe): MiddlewareHandler<ActivityEnv> {
  return async (c, next) => {
    await next();
    const { dataDir, now } = c.var.config;
    try {
      const facts = await describe(c);
      const refusal = c.var.activityNote?.refusal ?? (await refusalIn(c.res));
      const at = now();
      const entry: ActivityEntry = {
        id: randomUUID(),
        at: at.toISOString(),
        method: c.req.method,
        status: c.res.status,
        ...facts,
        error: refusal?.error,
        errorDescription: refusal?.description,
      };
      appendEntry(dataDir, entry, at).catch((error: unknown) => {
        warn(error);
      });
    } catch (error) {
      warn(error);
    }
  };
}

function warn(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`Could not write the IndieAuth and Micropub activity log: ${reason}`);
}

/**
 * The OAuth or Micropub error a response carries: in a JSON error body, or in
 * the query of a redirect back to the client. Only those two fields are read.
 */
async function refusalIn(
  response: Response,
): Promise<{ error: string; description: string | undefined } | undefined> {
  const location = response.headers.get('location');
  if (location !== null) {
    const query = URL.parse(location, 'http://localhost/')?.searchParams;
    const error = query?.get('error');
    if (error != null) return { error, description: query?.get('error_description') ?? undefined };
  }
  const type = response.headers.get('content-type') ?? '';
  if (response.status < 400 || !/^application\/json\b/i.test(type)) return undefined;
  const body = (await response.clone().json()) as Record<string, unknown>;
  const error = body['error'];
  const description = body['error_description'];
  if (typeof error !== 'string') return undefined;
  return { error, description: typeof description === 'string' ? description : undefined };
}

/** `value`, cut to {@link VALUE_LIMIT} characters with an ellipsis when it was longer. */
function short(value: string): string {
  return value.length > VALUE_LIMIT ? `${value.slice(0, VALUE_LIMIT)}…` : value;
}

/** A JSON value as one line of text, every secret field inside it replaced. */
function summary(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.join(', ');
  }
  return (
    JSON.stringify(value, (key, inner: unknown) =>
      SECRET_FIELDS.has(key) ? '[not recorded]' : inner,
    ) ?? ''
  );
}

function field(name: string, value: unknown): CarriedField {
  if (SECRET_FIELDS.has(name)) return { name: short(name), redacted: true };
  return { name: short(name), value: short(summary(value)) };
}

function fromParams(params: URLSearchParams, skip: readonly string[] = []): CarriedField[] {
  return [...params]
    .filter(([name]) => !skip.includes(name))
    .map(([name, value]) => field(name, value))
    .slice(0, CARRIED_LIMIT);
}

function fromForm(form: FormData): CarriedField[] {
  const fields: CarriedField[] = [];
  for (const [name, value] of form) {
    fields.push(
      typeof value === 'string' || SECRET_FIELDS.has(name)
        ? field(name, value)
        : {
            name: short(name),
            file: { filename: short(value.name), type: short(value.type), size: value.size },
          },
    );
  }
  return fields.slice(0, CARRIED_LIMIT);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A Micropub JSON body's fields: its `properties` one by one, then everything else. */
function fromJson(body: unknown): CarriedField[] {
  if (!isRecord(body)) return [];
  const fields: CarriedField[] = [];
  for (const [name, value] of Object.entries(body)) {
    if (name === 'properties' && isRecord(value)) {
      for (const [property, values] of Object.entries(value)) fields.push(field(property, values));
    } else {
      fields.push(field(name, value));
    }
  }
  return fields.slice(0, CARRIED_LIMIT);
}

/**
 * The body the route already read, never one it left unread: an upload
 * refused for its size before anything touched it stays untouched.
 */
async function readBody(
  c: Context<ActivityEnv>,
): Promise<{ kind: 'form'; form: FormData } | { kind: 'json'; value: unknown } | { kind: 'none' }> {
  if (Object.keys(c.req.bodyCache).length === 0) return { kind: 'none' };
  const type = c.req.header('content-type') ?? '';
  if (/^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i.test(type)) {
    return { kind: 'form', form: await c.req.formData() };
  }
  if (/^application\/json\b/i.test(type)) {
    try {
      return { kind: 'json', value: await c.req.json() };
    } catch {
      return { kind: 'none' };
    }
  }
  return { kind: 'none' };
}

/** What the route's form body said `name` was, when it was text. */
function formText(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === 'string' ? short(value) : undefined;
}

/** The authorization request, as the consent screen received it. */
export const logAuthorizationRequest = recordActivity((c) => {
  const params = new URL(c.req.url).searchParams;
  const userId = c.var.session?.userId;
  const user = userId == null ? undefined : findUserById(c.var.config.dataDir, userId);
  const clientId = params.get('client_id');
  return Promise.resolve({
    endpoint: 'authorization',
    action: 'request',
    clientId: clientId === null ? undefined : short(clientId),
    user: user?.username,
    pkce:
      (params.get('code_challenge') ?? '') !== '' && params.get('code_challenge_method') === 'S256',
    scopes: (params.get('scope') ?? '')
      .split(' ')
      .filter((scope) => scope !== '')
      .map(short),
    carried: fromParams(params),
  });
});

/** A client redeeming its code at the authorization endpoint for the profile. */
export const logAuthorizationRedemption = recordActivity(async (c) => {
  const body = await readBody(c);
  const form = body.kind === 'form' ? body.form : new FormData();
  return {
    endpoint: 'authorization',
    action: 'redeem',
    clientId: formText(form, 'client_id'),
    user: c.var.activityNote?.user,
    carried: fromForm(form),
  };
});

/** A client redeeming a code or a refresh token at the token endpoint. */
export const logTokenRequest = recordActivity(async (c) => {
  const body = await readBody(c);
  const form = body.kind === 'form' ? body.form : new FormData();
  return {
    endpoint: 'token',
    action: formText(form, 'grant_type') ?? 'authorization_code',
    clientId: formText(form, 'client_id'),
    user: c.var.activityNote?.user,
    scopes: c.var.activityNote?.scopes ?? [],
    carried: fromForm(form),
  };
});

/** Who a Micropub request acted as, once the bearer guard let it in. */
function bearerFacts(c: Context<ActivityEnv>): Pick<Facts, 'clientId' | 'user'> {
  const { bearer } = c.var;
  return { clientId: bearer?.token.clientId, user: bearer?.user.username };
}

/** A query, or a create, update, delete or undelete, at the Micropub endpoint. */
export const logMicropubRequest = recordActivity(async (c) => {
  if (c.req.method === 'GET') {
    const params = new URL(c.req.url).searchParams;
    return {
      endpoint: 'micropub',
      action: short(`q=${params.get('q') ?? ''}`),
      ...bearerFacts(c),
      carried: fromParams(params, ['q']),
    };
  }
  const body = await readBody(c);
  const carried =
    body.kind === 'form' ? fromForm(body.form) : body.kind === 'json' ? fromJson(body.value) : [];
  const named =
    body.kind === 'form'
      ? body.form.get('action')
      : body.kind === 'json' && isRecord(body.value)
        ? body.value['action']
        : undefined;
  return {
    endpoint: 'micropub',
    action: typeof named === 'string' ? short(named) : 'create',
    ...bearerFacts(c),
    carried,
  };
});

/** An upload, or `q=last`, at the media endpoint. */
export const logMediaRequest = recordActivity(async (c) => {
  if (c.req.method === 'GET') {
    const params = new URL(c.req.url).searchParams;
    return {
      endpoint: 'media',
      action: short(`q=${params.get('q') ?? ''}`),
      ...bearerFacts(c),
      carried: fromParams(params, ['q']),
    };
  }
  const body = await readBody(c);
  return {
    endpoint: 'media',
    action: 'upload',
    ...bearerFacts(c),
    carried: body.kind === 'form' ? fromForm(body.form) : [],
  };
});
