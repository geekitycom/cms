import type { MessageQueue } from '@fedify/fedify';

import type { DeliveryStore } from '../store/deliveries.ts';
import { listWaitingDeliveries } from '../store/queue-database.ts';
import type { Clock } from '../util/clock.ts';

/**
 * Mark `unknown` every delivery still recorded as waiting that the queue no
 * longer holds a message for. Runs before anything can send, so a row written
 * just before its message was enqueued is never caught. A queue the site
 * supplies cannot be read, so its rows are left as they are.
 */
export function markForgottenDeliveries(
  deliveries: Pick<DeliveryStore, 'markUnsettledDeliveriesUnknown'>,
  site: {
    readonly dataDir: string;
    readonly queue: MessageQueue | null | undefined;
    readonly now: Clock;
  },
): void {
  if (site.queue !== undefined && site.queue !== null) return;
  deliveries.markUnsettledDeliveriesUnknown({
    before: site.now().toISOString(),
    waiting: site.queue === null ? [] : listWaitingDeliveries(site.dataDir),
  });
}
