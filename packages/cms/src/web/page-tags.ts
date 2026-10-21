import type { MiddlewareHandler } from 'hono';

import { drawPageTags, NO_PAGE_TAGS } from '../plugins/page-tags.ts';
import type { DrawnPageTags } from '../plugins/page-tags.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import { messageOf } from '../util/errors.ts';
import type { GeekityEnv } from './env.ts';
import { drawnWithPageTags } from './render.ts';
import { requestPath } from './request.ts';

export const pluginPageTags: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  const pathname = requestPath(c);
  const tagging = [...c.var.activePlugins].flatMap((name) => {
    const read = c.var.plugins.find(name)?.pageTags;
    return read === undefined ? [] : [{ name, read }];
  });
  if (
    tagging.length === 0 ||
    pathname === ADMIN_PREFIX ||
    pathname.startsWith(`${ADMIN_PREFIX}/`)
  ) {
    c.set('pageTags', NO_PAGE_TAGS);
    return await next();
  }

  const context = { signedIn: c.var.signedIn !== undefined, devMode: c.var.devMode };
  const drawn: DrawnPageTags[] = [];
  for (const { name, read } of tagging) {
    try {
      drawn.push(drawPageTags(await read(context)));
    } catch (error) {
      console.warn(`The ${name} plugin's page tags were left out: ${messageOf(error)}`);
    }
  }
  const tags: DrawnPageTags = {
    headEnd: joined(drawn.map((entry) => entry.headEnd)),
    bodyEnd: joined(drawn.map((entry) => entry.bodyEnd)),
  };
  c.set('pageTags', tags);
  await drawnWithPageTags(tags, next);
};

function joined(parts: readonly string[]): string {
  const drawn = parts.filter((part) => part !== '');
  return drawn.length === 0 ? '' : `${drawn.join('\n')}\n`;
}
