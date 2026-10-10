import type { Context, Hono } from 'hono';

import { readSiteSettings } from '../admin/settings.ts';
import { clientAddress } from '../admin/throttle.ts';
import { answerable, commentPolicyOf } from '../comments/policy.ts';
import type { Document } from '../content/document.ts';
import type { GeekityEnv } from '../env.ts';
import { publicDocumentAt } from '../web/documents.ts';
import { escapeXml } from '../web/feed-xml.ts';
import { checkWebmentionRequest } from './receive.ts';
import type { RequestProblem, WebmentionOutcome } from './receive.ts';
import { webmentionEndpointFor } from './routes.ts';

/**
 * Pingback 1.0, which is how most WordPress sites say they linked here.
 *
 * A pingback is a webmention that arrived another way: the same source and
 * target, put through the same check, verification, spam checker and
 * moderation queue, and filed as the same comment. Only the envelope differs.
 * It is an XML-RPC call, and the spec has the receiver answer once it knows,
 * so the source is fetched inside the request rather than after it, and the
 * answer is one of the fault codes the spec defines.
 */

/** Where a pingback is sent. */
export const PINGBACK_PATH = '/_geekity/pingback';

/** Far more than two URLs in an XML-RPC envelope could need. */
export const PINGBACK_MAX_BYTES = 16 * 1024;

/**
 * The fault codes a pingback is answered with: the spec's own, and the XML-RPC
 * interoperability codes for a call that is not a pingback at all.
 */
export const PINGBACK_FAULTS = {
  generic: 0,
  sourceMissing: 0x0010,
  noLink: 0x0011,
  targetMissing: 0x0020,
  notATarget: 0x0021,
  alreadyRegistered: 0x0030,
  notWellFormed: -32700,
  unknownMethod: -32601,
  badParams: -32602,
} as const;

interface Fault {
  readonly code: number;
  readonly message: string;
}

const REQUEST_FAULTS: Record<RequestProblem, number> = {
  source: PINGBACK_FAULTS.sourceMissing,
  target: PINGBACK_FAULTS.targetMissing,
  elsewhere: PINGBACK_FAULTS.notATarget,
  same: PINGBACK_FAULTS.notATarget,
};

/**
 * The endpoint a document should advertise, or `undefined` when it should not.
 *
 * Every post, and a page only while it takes comments, and nothing when the
 * site takes no webmentions: the same switch, since they are the same thing.
 */
export function pingbackEndpointFor(
  site: Record<string, unknown>,
  document: Document,
  now: Date,
): string | undefined {
  if (webmentionEndpointFor(site) === undefined) return undefined;
  return answerable(document, commentPolicyOf(site), now) ? PINGBACK_PATH : undefined;
}

/** Register the pingback endpoint. Mounted by the public site. */
export function mountPingbacks(app: Hono<GeekityEnv>): void {
  app.post(PINGBACK_PATH, async (c) => {
    if (!readSiteSettings(c.var.config.contentDir).webmentionsReceive) {
      return c.text('This site does not take pingbacks.', 404);
    }

    const answer = await answerPing(c);
    return c.body(typeof answer === 'string' ? success(answer) : fault(answer), 200, {
      'content-type': 'text/xml; charset=utf-8',
    });
  });

  app.get(PINGBACK_PATH, (c) => {
    c.header('allow', 'POST');
    return c.text('Send a pingback here as an XML-RPC pingback.ping POST.', 405);
  });
}

async function answerPing(c: Context<GeekityEnv>): Promise<string | Fault> {
  const { store, config, webmentions, renderer, conversation } = c.var;

  const xml = await readBounded(c.req.raw, PINGBACK_MAX_BYTES);
  if (xml === undefined) {
    return { code: PINGBACK_FAULTS.notWellFormed, message: 'The call is too large.' };
  }

  const call = readMethodCall(xml);
  if ('code' in call) return call;
  if (call.method !== 'pingback.ping') {
    return { code: PINGBACK_FAULTS.unknownMethod, message: 'Only pingback.ping is served here.' };
  }
  const [source, target] = call.params;
  if (call.params.length !== 2 || source === undefined || target === undefined) {
    return {
      code: PINGBACK_FAULTS.badParams,
      message: 'pingback.ping takes a source and a target.',
    };
  }

  const checked = checkWebmentionRequest(source, target, {
    baseUrl: config.baseUrl,
    documentAt: (pathname) => publicDocumentAt(store, pathname),
    conversation,
  });
  if (!checked.ok) return { code: REQUEST_FAULTS[checked.problem], message: checked.message };

  if (pingbackEndpointFor(renderer.site(), checked.document, config.now()) === undefined) {
    return { code: PINGBACK_FAULTS.notATarget, message: 'That page takes no pingbacks.' };
  }

  const outcome = await webmentions.receive({
    source: checked.source,
    target: checked.target,
    document: checked.document,
    address: clientAddress(c, config),
    userAgent: c.req.header('user-agent'),
    referrer: c.req.header('referer'),
  });
  return answerFor(outcome);
}

function answerFor(outcome: WebmentionOutcome): string | Fault {
  switch (outcome.kind) {
    case 'stored':
      // The entry has been rewritten from the source as it now reads, exactly
      // as a webmention sent again rewrites it; the sender is told it was
      // already here, which is what the spec has it told.
      return outcome.created
        ? 'Thanks. The pingback is waiting for a moderator.'
        : { code: PINGBACK_FAULTS.alreadyRegistered, message: 'That pingback is already here.' };
    case 'unreachable':
      return {
        code: PINGBACK_FAULTS.generic,
        message: `The source could not be read: ${outcome.reason}`,
      };
    case 'deleted':
    case 'ignored':
      switch (outcome.why) {
        case 'gone':
          return { code: PINGBACK_FAULTS.sourceMissing, message: 'The source does not exist.' };
        case 'unlinked':
          return { code: PINGBACK_FAULTS.noLink, message: 'The source does not link here.' };
        case 'discarded':
          return { code: PINGBACK_FAULTS.generic, message: 'The pingback was not accepted.' };
      }
  }
}

type MethodCall = { readonly method: string; readonly params: readonly string[] };

const CALL =
  /^<methodCall>\s*<methodName>([^<]*)<\/methodName>\s*(?:<params>([^]*)<\/params>\s*)?<\/methodCall>$/;
const PARAM =
  /\s*<param>\s*<value>(?:\s*<string>([^<]*)<\/string>\s*|([^<]*))<\/value>\s*<\/param>\s*/y;

function readMethodCall(xml: string): MethodCall | Fault {
  const refused = { code: PINGBACK_FAULTS.notWellFormed, message: 'The call is not well formed.' };

  const body = xml
    .replace(/^\s*<\?xml[^?]*\?>/, '')
    .replaceAll(/<!--[^]*?-->/g, '')
    .trim();
  if (hasDeclarationOrInstruction(body)) return refused;

  const call = CALL.exec(body);
  if (call === null) return refused;

  const params: string[] = [];
  const list = (call[2] ?? '').trim();
  PARAM.lastIndex = 0;
  while (PARAM.lastIndex < list.length) {
    const param = PARAM.exec(list);
    if (param === null) return refused;
    const value = decodeText(param[1] ?? param[2] ?? '');
    if (value === undefined) return refused;
    params.push(value);
  }

  const method = decodeText(call[1] ?? '');
  if (method === undefined) return refused;
  return { method: method.trim(), params: params.map((param) => param.trim()) };
}

function hasDeclarationOrInstruction(body: string): boolean {
  return body.includes('<!') || body.includes('<?');
}

const PREDEFINED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeText(text: string): string | undefined {
  let unknown = false;
  const decoded = text.replaceAll(/&([^;&]*);|&/g, (whole, name: string | undefined) => {
    const resolved = name === undefined ? undefined : reference(name);
    if (resolved === undefined) unknown = true;
    return resolved ?? whole;
  });
  return unknown ? undefined : decoded;
}

function reference(name: string): string | undefined {
  const numeric = /^#(?:x([0-9a-f]+)|([0-9]+))$/i.exec(name);
  if (numeric === null) return PREDEFINED[name];
  const point = numeric[1] === undefined ? Number(numeric[2]) : parseInt(numeric[1], 16);
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : undefined;
}

async function readBounded(request: Request, max: number): Promise<string | undefined> {
  if (Number(request.headers.get('content-length') ?? 0) > max) return undefined;
  if (request.body === null) return '';

  const reader = (request.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = '';
  let read = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      read += chunk.value.length;
      if (read > max) return undefined;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

function success(message: string): string {
  return `<?xml version="1.0"?>
<methodResponse><params><param><value><string>${escapeXml(message)}</string></value></param></params></methodResponse>
`;
}

function fault({ code, message }: Fault): string {
  return `<?xml version="1.0"?>
<methodResponse><fault><value><struct>
<member><name>faultCode</name><value><int>${String(code)}</int></value></member>
<member><name>faultString</name><value><string>${escapeXml(message)}</string></value></member>
</struct></value></fault></methodResponse>
`;
}
