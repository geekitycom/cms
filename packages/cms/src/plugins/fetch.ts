/**
 * A plugin's outbound fetch (decision-33): `GET` another site's URL with the
 * rule the site's federation keeps, so a plugin cannot be steered into the
 * site's own network unless the site allows private addresses.
 */

import type { PluginFetchInit } from '../plugin.ts';
import { webUrl } from '../webmention/fetch-public.ts';
import { publicHost } from '../webmention/public-address.ts';
import type { HostLookup } from '../webmention/public-address.ts';

/** How many redirects are followed, each one checked like the first. */
const MAX_REDIRECTS = 5;

/** What decides which addresses a plugin may reach. */
export interface PluginFetchOptions {
  /** The site federation's own switch; on only for tests and private networks. */
  allowPrivateAddress: boolean;
  lookup: HostLookup;
}

export async function pluginFetch(
  target: string,
  init: PluginFetchInit,
  options: PluginFetchOptions,
): Promise<Response> {
  let at = target;
  for (let hop = 0; ; hop += 1) {
    const url = webUrl(at);
    if (url === undefined) throw new Error(`${at} is not an http or https URL.`);
    if (!options.allowPrivateAddress && !(await publicHost(url.hostname, options.lookup))) {
      throw new Error(`${url.href} is not a public address.`);
    }

    const response = await fetch(url, {
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.signal === undefined ? {} : { signal: init.signal }),
      redirect: 'manual',
    });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || location === null) return response;

    await response.body?.cancel();
    if (hop === MAX_REDIRECTS) throw new Error(`${target} redirected too many times.`);
    at = new URL(location, url).href;
  }
}
