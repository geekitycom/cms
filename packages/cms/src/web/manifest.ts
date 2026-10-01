import { manifestIcons } from '../images/icons.ts';
import type { ManifestIcon } from '../images/icons.ts';
import type { ImageConfig } from '../images/paths.ts';
import { absoluteUrl, contentEtag, isNotModified } from './negotiate.ts';
import type { ConditionalHeaders } from './negotiate.ts';
import type { ThemeColors } from './themes.ts';

/**
 * The web app manifest (TASK-147): what a browser reads before it offers to
 * install the site, and what a launcher draws it with.
 *
 * A fixed route at the root for the reason `robots.txt` is one, so no
 * permalink can take it, and linked from the head of every page.
 */

/** The manifest's URL. */
export const MANIFEST_PATH = '/manifest.webmanifest';

/** The icon every browser and crawler asks the root for, linked or not. */
export const FAVICON_PATH = '/favicon.ico';

const MANIFEST_CONTENT_TYPE = 'application/manifest+json; charset=utf-8';

/** The manifest as JSON, before it is serialised. */
export interface WebManifest {
  name: string;
  short_name: string;
  start_url: string;
  /**
   * `minimal-ui`: an installed blog keeps a back button and a reload, because
   * a reader follows links out of it and has to find the way back.
   */
  display: 'minimal-ui';
  theme_color?: string;
  background_color?: string;
  icons: ManifestIcon[];
}

/**
 * The manifest of one site.
 *
 * The name is the site's title for both the long and the short form; a
 * launcher shortens a long one itself. The colours are the chosen theme's
 * light `themeColor`, which in the default theme is also its page background,
 * so the splash screen a launcher paints before the first page loads is the
 * page's own colour. Every URL carries the base path of a site served from a
 * subdirectory.
 */
export function webManifest(input: {
  config: ImageConfig & { baseUrl: string };
  title: string;
  iconSetting: string | undefined;
  colors: ThemeColors;
}): WebManifest {
  const { config } = input;
  const color = input.colors.themeColor.light;
  return {
    name: input.title,
    short_name: input.title,
    start_url: sitePath('/', config.baseUrl),
    display: 'minimal-ui',
    ...(color === undefined ? {} : { theme_color: color, background_color: color }),
    icons: manifestIcons(config, input.iconSetting).map((icon) => ({
      ...icon,
      src: sitePath(icon.src, config.baseUrl),
    })),
  };
}

/** The manifest as a response, or a 304 to a client that already holds it. */
export function manifestResponse(
  manifest: WebManifest,
  conditional: ConditionalHeaders | undefined,
): Response {
  const body = JSON.stringify(manifest, null, 2);
  const etag = contentEtag('manifest', body);
  const headers = new Headers({ etag, 'cache-control': 'no-cache' });

  if (isNotModified(conditional, etag, undefined)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', MANIFEST_CONTENT_TYPE);
  return new Response(body, { headers });
}

/** A site-root path with the base path of a site served from a subdirectory. */
function sitePath(pathname: string, baseUrl: string): string {
  const url = new URL(absoluteUrl(pathname, baseUrl));
  return `${url.pathname}${url.search}`;
}
