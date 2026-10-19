import type { InboxRefusalReason, JsonLdDocument } from '../plugin.ts';
import type { Clock } from '../util/clock.ts';

/**
 * How far a signature's date may be from now before Fedify refuses it: its
 * default `signatureTimeWindow`, which neither the site's federation nor a
 * plugin's overrides.
 */
const SIGNATURE_TIME_WINDOW_MS = 60 * 60 * 1000;

/** How long one keyId's refusals after the first are counted rather than logged. */
export const REFUSAL_LOG_WINDOW_MS = 5 * 60 * 1000;

/**
 * The log of inbox deliveries refused for their signature (TASK-427). One
 * instance serves the site's inboxes and every plugin's, so a peer retrying
 * at several of them is still one burst.
 */
export interface InboxRefusals {
  refused(request: Request, activity: JsonLdDocument, reason: InboxRefusalReason): void;
}

export interface InboxRefusalsOptions {
  now: Clock;
  warn: (line: string) => void;
}

interface Burst {
  readonly loggedAt: number;
  suppressed: number;
}

export function createInboxRefusals(options: InboxRefusalsOptions): InboxRefusals {
  const bursts = new Map<string, Burst>();

  function sweep(at: number): void {
    for (const [key, burst] of bursts) {
      if (at - burst.loggedAt < REFUSAL_LOG_WINDOW_MS) continue;
      bursts.delete(key);
      if (burst.suppressed > 0) {
        options.warn(
          `Suppressed ${String(burst.suppressed)} more inbox refusals for keyId=${key} ` +
            `after the one logged at ${new Date(burst.loggedAt).toISOString()}`,
        );
      }
    }
  }

  return {
    refused(request, activity, reason) {
      const at = options.now().getTime();
      sweep(at);

      const keyId = 'keyId' in reason && reason.keyId !== undefined ? reason.keyId.href : 'none';
      const actor = idOf(activity.actor);
      const key = keyId === 'none' ? `none (actor ${actor})` : keyId;
      const burst = bursts.get(key);
      if (burst !== undefined) {
        burst.suppressed += 1;
        return;
      }
      bursts.set(key, { loggedAt: at, suppressed: 0 });

      options.warn(
        `Refused an inbox POST to ${new URL(request.url).pathname}: ` +
          `${describe(request, reason, at)}; keyId=${keyId} actor=${actor} ` +
          `type=${typeOf(activity.type)} id=${idOf(activity.id)}`,
      );
    },
  };
}

function describe(request: Request, reason: InboxRefusalReason, at: number): string {
  switch (reason.type) {
    case 'keyFetchError':
      return 'status' in reason.result
        ? `key not fetchable (HTTP ${String(reason.result.status)})`
        : `key not fetchable (${reason.result.error.name}: ${reason.result.error.message})`;
    case 'invalidSignature': {
      const stale = staleDate(request, at);
      return stale === undefined ? 'signature mismatch' : `date out of range (${stale})`;
    }
    case 'noSignature':
      return 'no signature';
  }
}

/**
 * The request's Date header, or failing that its RFC 9421 `created` time,
 * when it is outside the window Fedify checks it against.
 */
function staleDate(request: Request, at: number): string | undefined {
  const outside = (time: number) => Math.abs(time - at) > SIGNATURE_TIME_WINDOW_MS;

  const header = request.headers.get('date');
  if (header !== null) {
    const time = Date.parse(header);
    return Number.isNaN(time) || !outside(time) ? undefined : `Date ${header}`;
  }
  const created = /;created=(\d+)/.exec(request.headers.get('signature-input') ?? '')?.[1];
  if (created === undefined) return undefined;
  const time = Number(created) * 1000;
  return outside(time) ? `created ${new Date(time).toISOString()}` : undefined;
}

function idOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return idOf(value[0]);
  if (typeof value === 'object' && value !== null && 'id' in value) return idOf(value.id);
  return 'none';
}

function typeOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return 'none';
}
