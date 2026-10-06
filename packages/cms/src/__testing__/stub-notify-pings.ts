import { DEFAULT_NOTIFY_SERVER, notifyEndpoints } from '../web/feeds.ts';

const ping = notifyEndpoints(DEFAULT_NOTIFY_SERVER)?.ping;
const passOn = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === ping) return new Response(null, { status: 200 });
  return await passOn(input, init);
};
