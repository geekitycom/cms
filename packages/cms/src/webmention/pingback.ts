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

/**
 * How long a ping waits for its check before it is answered that the check
 * is still running. Longer than one read of the source may take, so only a
 * check that waited for others runs past it.
 */
export const PINGBACK_ANSWER_MS = 20_000;

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
  upstreamError: 0x0032,
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

export function pingbackEndpointFor(site: Record<string, unknown>): string | undefined {
  return webmentionEndpointFor(site) === undefined ? undefined : PINGBACK_PATH;
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
    case 'refused':
      return { code: PINGBACK_REQUEST_FAULTS[outcome.problem], message: outcome.message };
    case 'unreachable':
      return {
        code: PINGBACK_FAULTS.upstreamError,
        message: 'The source could not be read this time.',
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

interface XmlElement {
  readonly name: string;
  readonly children: XmlElement[];
  text: string;
}

const OPEN_TAG =
  /<([A-Za-z_][\w.:-]*)(?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*(\/?)>/y;
const CLOSE_TAG = /<\/([A-Za-z_][\w.:-]*)\s*>/y;
const XML_DECLARATION = /^\uFEFF?\s*<\?xml(?:\s[^?]*)?\?>/;

export function readPingbackCall(xml: string): PingbackCall | PingbackFault {
  const refused = { code: PINGBACK_FAULTS.notWellFormed, message: 'The call is not well formed.' };

  const root = parseXml(xml);
  if (root?.name !== 'methodCall' || !isBlank(root.text)) return refused;
  const [name, params, ...rest] = root.children;
  if (name?.name !== 'methodName' || name.children.length > 0 || rest.length > 0) return refused;
  if (params !== undefined && (params.name !== 'params' || !isBlank(params.text))) return refused;

  const values: string[] = [];
  for (const param of params?.children ?? []) {
    const value = paramValue(param);
    if (value === undefined) return refused;
    values.push(value.trim());
  }
  return { method: name.text.trim(), params: values };
}

function paramValue(param: XmlElement): string | undefined {
  const [value, ...rest] = param.children;
  if (param.name !== 'param' || !isBlank(param.text) || value?.name !== 'value') return undefined;
  if (rest.length > 0) return undefined;
  const [string, ...more] = value.children;
  if (string === undefined) return value.text;
  if (string.name !== 'string' || string.children.length > 0 || more.length > 0) return undefined;
  return isBlank(value.text) ? string.text : undefined;
}

function parseXml(xml: string): XmlElement | undefined {
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let at = XML_DECLARATION.exec(xml)?.[0].length ?? 0;

  while (at < xml.length) {
    const open = xml.indexOf('<', at);
    if (open !== at) {
      const end = open === -1 ? xml.length : open;
      const text = decodeText(xml.slice(at, end));
      const parent = stack.at(-1);
      if (text === undefined || (parent === undefined && !isBlank(text))) return undefined;
      if (parent !== undefined) parent.text += text;
      at = end;
      continue;
    }

    if (xml.startsWith('<!--', at)) {
      const end = xml.indexOf('-->', at + 4);
      if (end === -1) return undefined;
      at = end + 3;
    } else if (xml.startsWith('<![CDATA[', at)) {
      const end = xml.indexOf(']]>', at + 9);
      const parent = stack.at(-1);
      if (end === -1 || parent === undefined) return undefined;
      parent.text += xml.slice(at + 9, end);
      at = end + 3;
    } else if (xml.startsWith('</', at)) {
      CLOSE_TAG.lastIndex = at;
      const tag = CLOSE_TAG.exec(xml);
      const element = stack.pop();
      if (tag === null || element?.name !== tag[1]) return undefined;
      if (stack.length === 0) root = element;
      at = CLOSE_TAG.lastIndex;
    } else {
      OPEN_TAG.lastIndex = at;
      const tag = OPEN_TAG.exec(xml);
      if (tag === null || root !== undefined) return undefined;
      const element: XmlElement = { name: tag[1] ?? '', children: [], text: '' };
      stack.at(-1)?.children.push(element);
      if (tag[2] === '/') {
        if (stack.length === 0) root = element;
      } else {
        stack.push(element);
      }
      at = OPEN_TAG.lastIndex;
    }
  }
  return stack.length === 0 ? root : undefined;
}

function isBlank(text: string): boolean {
  return text.trim() === '';
}

const PREDEFINED: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

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
  if (numeric === null) return PREDEFINED.get(name);
  const point = numeric[1] === undefined ? Number(numeric[2]) : parseInt(numeric[1], 16);
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : undefined;
}
