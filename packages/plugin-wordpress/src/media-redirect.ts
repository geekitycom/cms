import type { PluginDataFolder, PluginRouteHandler } from '@geekity/cms/plugin';

import { IMPORT_RECORD_FILE } from './content-import.ts';
import { decoded, uploadUrl, variantCandidates, WORDPRESS_UPLOADS } from './media.ts';

/** The path the route answers, in Hono's syntax. */
export const WORDPRESS_UPLOADS_ROUTE = `${WORDPRESS_UPLOADS}*`;

/**
 * `/wp-content/uploads/<path>` answers 301 at `/uploads/<path>`, so a link
 * from elsewhere to a WordPress upload still lands on the file. A size variant
 * the import never copied lands on the original it copied, as `import.json`
 * records it; any other path keeps its name.
 */
export function wordPressUploadsRedirect(data: PluginDataFolder): PluginRouteHandler {
  let cached: { text: string | undefined; copied: ReadonlySet<string> } = {
    text: undefined,
    copied: new Set(),
  };
  const copied = (): ReadonlySet<string> => {
    const text = data.read(IMPORT_RECORD_FILE);
    if (cached.text !== text) {
      const files = text === undefined ? {} : (JSON.parse(text) as { files?: object }).files;
      cached = { text, copied: new Set(Object.keys(files ?? {})) };
    }
    return cached.copied;
  };

  return ({ request }) => {
    const url = new URL(request.url);
    const upload = decoded(url.pathname.slice(WORDPRESS_UPLOADS.length));
    const record = copied();
    const target =
      variantCandidates(upload).find((candidate) => record.has(`uploads/${candidate}`)) ?? upload;
    return new Response(null, {
      status: 301,
      headers: { location: `${uploadUrl(target)}${url.search}` },
    });
  };
}
