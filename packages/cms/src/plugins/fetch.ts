/**
 * A plugin's outbound fetch (decision-33): `GET` another site's URL, or `POST`
 * it a JSON body, with the rule the site's federation keeps, so a plugin
 * cannot be steered into the site's own network unless the site allows
 * private addresses.
 */

import type { PluginFetchInit } from '../plugin.ts';
import { webUrl } from '../webmention/fetch-public.ts';
import { publicHost } from '../util/public-address.ts';
import type { HostLookup } from '../util/public-address.ts';

/** How many redirects are followed, each one checked like the first. */
const MAX_REDIRECTS = 5;

/** Redirects that keep the method and body, as `fetch` has them. */
const KEEPS_BODY = new Set([307, 308]);

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
  if (init.json !== undefined && init.method !== 'POST') {
    throw new Error('A JSON body needs method POST.');
  }
  let method = init.method ?? 'GET';
  let body = init.json === undefined ? undefined : JSON.stringify(init.json);
  let at = target;
  for (let hop = 0; ; hop += 1) {
    const url = webUrl(at);
    if (url === undefined) throw new Error(`${at} is not an http or https URL.`);
    if (!options.allowPrivateAddress && !(await publicHost(url.hostname, options.lookup))) {
      throw new Error(`${url.href} is not a public address.`);
    }

    const headers = new Headers(init.headers);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      ...(init.signal === undefined ? {} : { signal: init.signal }),
      redirect: 'manual',
    });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || location === null) return response;

    await response.body?.cancel();
    if (hop === MAX_REDIRECTS) throw new Error(`${target} redirected too many times.`);
    const next = new URL(location, url);
    if (method === 'POST' && !KEEPS_BODY.has(response.status)) {
      method = 'GET';
      body = undefined;
    } else if (body !== undefined && next.origin !== url.origin) {
      throw new Error(
        `${url.href} redirected a POST to ${next.origin}, which is not sent the body.`,
      );
    }
    at = next.href;
  }
}
