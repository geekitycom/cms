import { signRequest } from '@fedify/fedify';

import { userForAuthor } from '../../content/authors.ts';
import { senderKeyPairs } from '../../federation/actor.ts';
import { listUsers, primaryUser } from '../../site/users.ts';
import { messageOf } from '../../util/errors.ts';
import { isRecord } from '../../util/guards.ts';
import { nullable } from '../../util/json-schema.ts';
import type { FromSchema } from '../../util/json-schema.ts';
import type { HostLookup } from '../../util/public-address.ts';
import { federationContextData } from '../../web/federation-routes.ts';
import { readWithin, requestPublic, webUrl } from '../../webmention/fetch-public.ts';
import { defineTool } from '../tools.ts';
import type { ToolSite } from '../tools.ts';
import { ANY_OBJECT, READ_ONLY } from './schemas.ts';

const LOOKUP_TIMEOUT_MS = 10_000;

const MAX_BYTES = 256 * 1024;

const ACTIVITY_ACCEPT =
  'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

const ACTIVITY_TYPE = /^application\/(activity\+json|ld\+json)/;

const HEADERS_SHOWN = [
  'content-type',
  'content-length',
  'location',
  'www-authenticate',
  'link',
  'cache-control',
  'vary',
  'last-modified',
  'etag',
  'date',
  'retry-after',
  'server',
] as const;

export type RemoteTarget =
  | { readonly kind: 'handle'; readonly user: string; readonly host: string }
  | { readonly kind: 'url'; readonly url: URL };

const EXCHANGE = {
  type: 'object',
  properties: {
    requested: { type: 'string', description: 'The URL asked for.' },
    url: { type: 'string', description: 'The URL that answered, after any redirects.' },
    status: { type: 'integer' },
    headers: {
      type: 'array',
      description: 'The response headers that matter for debugging.',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, value: { type: 'string' } },
        required: ['name', 'value'],
      },
    },
    json: nullable({ ...ANY_OBJECT, description: 'The body, when it is a JSON object.' }),
    text: nullable({ type: 'string', description: 'The body, when it is not a JSON object.' }),
    truncated: {
      type: 'boolean',
      description: `Whether the body was cut off at ${String(MAX_BYTES)} bytes.`,
    },
  },
  required: ['requested', 'url', 'status', 'headers', 'json', 'text', 'truncated'],
} as const;

type Exchange = FromSchema<typeof EXCHANGE>;

type Refusal = { readonly ok: false; readonly reason: string };

type RemoteLookup =
  | { readonly ok: true; readonly webfinger: Exchange | null; readonly object: Exchange | null }
  | Refusal;

interface LookupOptions {
  readonly lookup: HostLookup;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly signObjectFetch: ((request: Request) => Promise<Request>) | undefined;
}

const HANDLE = /^(?:acct:|@)?([^@\s/]+)@([^@\s/]+)$/;

function parseTarget(target: string): RemoteTarget | undefined {
  const handle = HANDLE.exec(target.trim());
  if (handle !== null) {
    const [, user = '', host = ''] = handle;
    const url = webUrl(`https://${host}/`);
    return url?.host === host.toLowerCase() ? { kind: 'handle', user, host: url.host } : undefined;
  }
  const url = webUrl(target.trim());
  return url === undefined ? undefined : { kind: 'url', url };
}

export async function lookupRemote(
  target: RemoteTarget,
  options: LookupOptions,
): Promise<RemoteLookup> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = AbortSignal.any([options.signal, timeout]);
  const refuse = (step: string, refused: Refusal): Refusal => ({
    ok: false,
    reason: `${step}: ${timeout.aborted ? `no answer within ${String(options.timeoutMs)} ms` : refused.reason}`,
  });

  let webfinger: Exchange | null = null;
  let objectUrl: string;
  if (target.kind === 'handle') {
    const url = new URL(`https://${target.host}/.well-known/webfinger`);
    url.searchParams.set('resource', `acct:${target.user}@${target.host}`);
    const answered = await exchange(url.href, {
      ...options,
      signal,
      accept: 'application/jrd+json, application/json',
      sign: undefined,
    });
    if (!answered.ok) return refuse('WebFinger', answered);
    webfinger = answered.exchange;
    const self = webfinger.status === 200 ? selfLink(webfinger.json) : undefined;
    if (self === undefined) return { ok: true, webfinger, object: null };
    objectUrl = self;
  } else {
    objectUrl = target.url.href;
  }

  const answered = await exchange(objectUrl, {
    ...options,
    signal,
    accept: ACTIVITY_ACCEPT,
    sign: options.signObjectFetch,
  });
  if (!answered.ok) return refuse(objectUrl, answered);
  return { ok: true, webfinger, object: answered.exchange };
}

function selfLink(jrd: Record<string, unknown> | null): string | undefined {
  const links = jrd?.['links'];
  if (!Array.isArray(links)) return undefined;
  for (const link of links as unknown[]) {
    if (!isRecord(link)) continue;
    const { rel, type, href } = link;
    if (rel === 'self' && typeof type === 'string' && ACTIVITY_TYPE.test(type)) {
      if (typeof href === 'string') return href;
    }
  }
  return undefined;
}

async function exchange(
  url: string,
  options: Omit<LookupOptions, 'signObjectFetch'> & {
    readonly accept: string;
    readonly sign: ((request: Request) => Promise<Request>) | undefined;
  },
): Promise<{ readonly ok: true; readonly exchange: Exchange } | Refusal> {
  const answered = await requestPublic(url, {
    lookup: options.lookup,
    signal: options.signal,
    headers: { accept: options.accept },
    sign: options.sign,
  });
  if (!answered.ok) return answered;
  const { response } = answered;
  try {
    const read = await readWithin(response, options.maxBytes, 'truncate');
    if (read === undefined) return { ok: false, reason: 'the body could not be read' };
    const body = new TextDecoder().decode(read.body);
    const json = asObject(body);
    return {
      ok: true,
      exchange: {
        requested: url,
        url: answered.url,
        status: response.status,
        headers: HEADERS_SHOWN.flatMap((name) => {
          const value = response.headers.get(name);
          return value === null ? [] : [{ name, value }];
        }),
        json,
        text: json === null ? body : null,
        truncated: read.truncated,
      },
    };
  } catch (thrown) {
    return { ok: false, reason: messageOf(thrown) };
  }
}

function asObject(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface Signer {
  readonly username: string;
  readonly keyId: string;
  readonly sign: (request: Request) => Promise<Request>;
}

async function signerFor(
  site: ToolSite,
  username: string | undefined,
): Promise<{ readonly ok: true; readonly signer: Signer | null } | Refusal> {
  const { dataDir } = site.config;
  const users = listUsers(dataDir);
  const user =
    username === undefined
      ? (userForAuthor(users, site.siteAtRequestStart.author) ?? primaryUser(dataDir))
      : users.find((candidate) => candidate.username === username);
  if (user === undefined) {
    return username === undefined
      ? { ok: true, signer: null }
      : { ok: false, reason: `There is no user named ${username}.` };
  }
  const context = site.federation.createContext(
    new URL(site.config.baseUrl),
    federationContextData(site),
  );
  const [key] = await senderKeyPairs(context, user);
  if (key === undefined) return { ok: false, reason: `${user.username} has no signing key.` };
  return {
    ok: true,
    signer: {
      username: user.username,
      keyId: key.keyId.href,
      sign: (request) => signRequest(request, key.privateKey, key.keyId),
    },
  };
}

export const remoteLookup = defineTool({
  name: 'remote_lookup',
  title: 'Look up a fediverse actor or object',
  description:
    'Fetches what a remote server answers the site: for @user@host, the WebFinger result and then the actor it names; for a URL, the object at it. The object fetch is signed with a local user’s key, as the site’s own fetches are, so servers in authorized fetch mode answer. Returns each request’s status, the headers that matter and the body. Only public addresses are reached, within 10 seconds and 256 KiB a body.',
  scope: 'inspect',
  annotations: { ...READ_ONLY, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'A handle such as @user@host, or the http or https URL of an actor or object.',
      },
      actor: {
        type: 'string',
        description: 'The username of the local user to sign as. The site author unless given.',
      },
    },
    required: ['target'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      signedAs: nullable({
        type: 'object',
        description: 'The local user the object fetch was signed as, or null when unsigned.',
        properties: { username: { type: 'string' }, keyId: { type: 'string' } },
        required: ['username', 'keyId'],
      }),
      webfinger: nullable({
        ...EXCHANGE,
        description: 'The WebFinger request for a handle, or null for a URL.',
      }),
      object: nullable({
        ...EXCHANGE,
        description: 'The actor or object fetch, or null when WebFinger named no actor.',
      }),
    },
    required: ['signedAs', 'webfinger', 'object'],
  },
  run: async (args, { site, signal }) => {
    const target = parseTarget(args.target);
    if (target === undefined) {
      return {
        ok: false,
        message: `${args.target} is neither a handle like @user@host nor an http or https URL.`,
      };
    }
    const signing = await signerFor(site, args.actor);
    if (!signing.ok) return { ok: false, message: signing.reason };
    const { signer } = signing;

    const found = await lookupRemote(target, {
      lookup: site.config.hostLookup,
      signal,
      timeoutMs: LOOKUP_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      signObjectFetch: signer?.sign,
    });
    if (!found.ok) return { ok: false, message: found.reason };
    const { webfinger, object } = found;

    const parts = [
      ...(webfinger === null
        ? []
        : [
            `WebFinger answered ${String(webfinger.status)}${object === null ? ' and named no ActivityPub actor' : ''}`,
          ]),
      ...(object === null
        ? []
        : [
            `${object.url} answered ${String(object.status)}${signer === null ? ' unsigned' : ` signed as ${signer.username}`}${object.truncated ? ', body truncated' : ''}`,
          ]),
    ];
    return {
      ok: true,
      summary: parts.join('; '),
      structured: {
        signedAs: signer === null ? null : { username: signer.username, keyId: signer.keyId },
        webfinger,
        object,
      },
    };
  },
});
