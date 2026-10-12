import { answerable, commentPolicyOf } from '../comments/policy.ts';
import type { Document } from '../content/document.ts';
import type { RequestProblem, WebmentionOutcome } from './receive.ts';
import { webmentionEndpointFor } from './endpoint.ts';

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

export interface PingbackFault {
  readonly code: number;
  readonly message: string;
}

export const PINGBACK_REQUEST_FAULTS: Record<RequestProblem, number> = {
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

export function pingbackAnswerFor(outcome: WebmentionOutcome): string | PingbackFault {
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

export type PingbackCall = { readonly method: string; readonly params: readonly string[] };

const CALL =
  /^<methodCall>\s*<methodName>([^<]*)<\/methodName>\s*(?:<params>([^]*)<\/params>\s*)?<\/methodCall>$/;
const PARAM =
  /\s*<param>\s*<value>(?:\s*<string>([^<]*)<\/string>\s*|([^<]*))<\/value>\s*<\/param>\s*/y;

export function readPingbackCall(xml: string): PingbackCall | PingbackFault {
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
