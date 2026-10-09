/**
 * What OpenRouter's public model list says about a model's reasoning: whether
 * it takes the `reasoning` parameter, and at which efforts. A call sends
 * `reasoning` only to a model that takes it, because with a schema it also
 * sends `provider.require_parameters`, which routes a request only to
 * endpoints that support every parameter in it.
 */

import { isRecord } from './connection.ts';
import type { LlmConnection } from './connection.ts';

/** OpenRouter's reasoning efforts, least first. */
export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** A model that takes the `reasoning` parameter. */
export interface ReasoningModel {
  /** The efforts it lists, or `undefined` when it lists none and takes any. */
  readonly efforts: readonly ReasoningEffort[] | undefined;
}

/** The reasoning model named `model`, or `undefined` for one that does not reason or is unknown. */
export type ModelCatalog = (
  connection: LlmConnection,
  model: string,
  signal?: AbortSignal,
) => Promise<ReasoningModel | undefined>;

/** How long the list is kept before it is read again. */
const KEPT_MS = 60 * 60 * 1000;

/** How long reading the list may take before the call goes ahead without it. */
const LOOKUP_TIMEOUT_MS = 10_000;

/** A catalog that keeps the list for an hour. A failed read is not kept, so the next call tries again. */
export function modelCatalog(): ModelCatalog {
  let kept:
    { baseUrl: string; at: number; models: ReadonlyMap<string, ReasoningModel> } | undefined;
  return async (connection, model, signal) => {
    if (
      kept === undefined ||
      kept.baseUrl !== connection.baseUrl ||
      Date.now() - kept.at > KEPT_MS
    ) {
      const models = await readModels(connection.baseUrl, signal);
      if (models === undefined) return undefined;
      kept = { baseUrl: connection.baseUrl, at: Date.now(), models };
    }
    return kept.models.get(model) ?? kept.models.get(model.split(':')[0] ?? model);
  };
}

/**
 * The effort to send for `asked`: itself when the model lists it, else the
 * least listed effort above it, else the most listed below it.
 */
export function effortFor(asked: ReasoningEffort, model: ReasoningModel): ReasoningEffort {
  const listed = model.efforts;
  if (listed === undefined || listed.length === 0 || listed.includes(asked)) return asked;
  const rank = (effort: ReasoningEffort) => REASONING_EFFORTS.indexOf(effort);
  const sorted = [...listed].sort((a, b) => rank(a) - rank(b));
  return sorted.find((effort) => rank(effort) > rank(asked)) ?? sorted.at(-1) ?? asked;
}

async function readModels(
  baseUrl: string,
  signal: AbortSignal | undefined,
): Promise<ReadonlyMap<string, ReasoningModel> | undefined> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.any([
        AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        ...(signal ? [signal] : []),
      ]),
    });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    const data = isRecord(body) ? body['data'] : undefined;
    if (!Array.isArray(data)) return undefined;
    const models = new Map<string, ReasoningModel>();
    for (const entry of data) {
      if (!isRecord(entry) || typeof entry['id'] !== 'string') continue;
      const parameters = entry['supported_parameters'];
      if (!Array.isArray(parameters) || !parameters.includes('reasoning')) continue;
      const reasoning = entry['reasoning'];
      const listed = isRecord(reasoning) ? reasoning['supported_efforts'] : undefined;
      models.set(entry['id'], {
        efforts: Array.isArray(listed) ? listed.filter(isEffort) : undefined,
      });
    }
    return models;
  } catch {
    return undefined;
  }
}

function isEffort(value: unknown): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly unknown[]).includes(value);
}
