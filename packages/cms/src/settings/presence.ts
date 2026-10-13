import { isRecord } from '../util/guards.ts';

export function presenceMeansOn(raw: unknown): unknown {
  if (!isRecord(raw)) return { on: true };
  return 'on' in raw ? raw : { on: true, ...raw };
}
