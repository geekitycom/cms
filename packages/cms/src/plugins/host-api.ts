import { HOST_API_VERSION } from '../plugin.ts';

export const OLDEST_HOST_API_VERSION = 2;

export function hostApiProblem(hostApi: number): string | undefined {
  if (hostApi >= OLDEST_HOST_API_VERSION && hostApi <= HOST_API_VERSION) return undefined;
  return `targets host API version ${String(hostApi)}, and this core provides versions ${String(OLDEST_HOST_API_VERSION)} to ${String(HOST_API_VERSION)}.`;
}
