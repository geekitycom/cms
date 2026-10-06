import { DEFAULT_NOTIFY_SERVER, notifyEndpoints } from '../web/feeds.ts';

/**
 * Imported for its effect: a test site that names no notify server pings
 * rpc.rsscloud.io every time it publishes, and no test that is not about the
 * ping cares, so the ping is answered here instead of leaving the machine.
 * notify.test.ts stubs fetch itself and sees every ping.
 */
const ping = notifyEndpoints(DEFAULT_NOTIFY_SERVER)?.ping;
const passOn = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === ping) return new Response(null, { status: 200 });
  return await passOn(input, init);
};
