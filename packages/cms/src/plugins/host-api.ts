import { HOST_API_VERSION } from '../plugin.ts';

/**
 * The oldest host API version this core still runs. It goes up with a release
 * that breaks a plugin written for an earlier version.
 */
export const OLDEST_HOST_API_VERSION = 2;

/** Why a plugin that targets `hostApi` cannot run on this core, or `undefined`. */
export function hostApiProblem(hostApi: number): string | undefined {
  if (hostApi >= OLDEST_HOST_API_VERSION && hostApi <= HOST_API_VERSION) return undefined;
  return `targets host API version ${String(hostApi)}, and this core provides versions ${String(OLDEST_HOST_API_VERSION)} to ${String(HOST_API_VERSION)}.`;
}
