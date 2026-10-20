import type { MiddlewareHandler } from 'hono';

import { drawPageTags, NO_PAGE_TAGS } from '../plugins/page-tags.ts';
import type { DrawnPageTags } from '../plugins/page-tags.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import { messageOf } from '../util/errors.ts';
import type { GeekityEnv } from './env.ts';
import { drawnWithPageTags } from './render.ts';
import { requestPath } from './request.ts';

/**
 * Read the page tags of every running plugin, in the order they run, and draw
 * the public pages of this request with them (decision-59). A plugin whose
 * `pageTags` throws, or returns a tag that breaks a rule, adds nothing and is
 * logged. The admin draws none.
 */
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

  const drawn: DrawnPageTags[] = [];
  for (const { name, read } of tagging) {
    try {
      drawn.push(drawPageTags(await read()));
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
