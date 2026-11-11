import { DEFAULT_DELIVERY_TIMEOUT_MS } from '../config.ts';
import type { ResolvedConfig } from '../config.ts';

/**
 * Wait for one delivery POST for as long as the config allows, and reject when
 * the inbox has not answered by then.
 *
 * Fedify 2.4.5 takes no signal or deadline for a delivery, and its HTTP client
 * waits five minutes for headers, so an inbox that accepts the connection and
 * never answers would hold a resend and a shutdown that long per post. The
 * request is left to finish or fail on its own, and what it ends in after the
 * deadline is dropped.
 */
export async function sendWithinDeadline(
  config: Pick<ResolvedConfig, 'federation'>,
  inbox: string,
  sending: Promise<void>,
): Promise<void> {
  const ms = config.federation.deliveryTimeoutMs ?? DEFAULT_DELIVERY_TIMEOUT_MS;
  sending.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      sending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`No answer from ${inbox} within ${String(ms / 1000)} s.`));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
