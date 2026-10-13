import type { Context, Hono } from 'hono';

import { publicDocumentAt } from '../content/permalinks.ts';
import {
  PINGBACK_FAULTS,
  PINGBACK_MAX_BYTES,
  PINGBACK_PATH,
  PINGBACK_REQUEST_FAULTS,
  pingbackAnswerFor,
  pingbackEndpointFor,
  readPingbackCall,
} from '../webmention/pingback.ts';
import type { PingbackFault } from '../webmention/pingback.ts';
import { checkWebmentionRequest } from '../webmention/receive.ts';
import type { GeekityEnv } from './env.ts';
import { escapeXml } from './feed-xml.ts';
import { clientAddress } from './throttle.ts';

/** Register the pingback endpoint. Mounted by the public site. */
export function mountPingbacks(app: Hono<GeekityEnv>): void {
  app.post(PINGBACK_PATH, async (c) => {
    if (!c.var.site.webmentions_receive) {
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

async function answerPing(c: Context<GeekityEnv>): Promise<string | PingbackFault> {
  const { store, config, webmentions, renderer, conversation } = c.var;

  const xml = await readBounded(c.req.raw, PINGBACK_MAX_BYTES);
  if (xml === undefined) {
    return { code: PINGBACK_FAULTS.notWellFormed, message: 'The call is too large.' };
  }

  const call = readPingbackCall(xml);
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
    site: c.var.site,
  });
  if (!checked.ok)
    return { code: PINGBACK_REQUEST_FAULTS[checked.problem], message: checked.message };

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
  return pingbackAnswerFor(outcome);
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

function fault({ code, message }: PingbackFault): string {
  return `<?xml version="1.0"?>
<methodResponse><fault><value><struct>
<member><name>faultCode</name><value><int>${String(code)}</int></value></member>
<member><name>faultString</name><value><string>${escapeXml(message)}</string></value></member>
</struct></value></fault></methodResponse>
`;
}
