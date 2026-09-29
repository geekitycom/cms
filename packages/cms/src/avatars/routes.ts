import type { Hono } from 'hono';

import type { GeekityEnv } from '../env.ts';
import { assetNotModified, assetResponse, matchesEtag } from '../web/assets.ts';
import {
  AVATAR_MAX_AGE_SECONDS,
  AVATAR_PATH_PREFIX,
  AVATAR_PLACEHOLDER_MAX_AGE_SECONDS,
  AVATAR_PLACEHOLDER_SVG,
  avatarSourceOf,
} from './avatars.ts';

/**
 * Register the avatar route. Mounted by the public site, under `/_geekity/`
 * like its other endpoints, so no permalink can take it.
 *
 * It is not exempt from maintenance mode: the only pages that show an avatar
 * are posts, and those are a 503 then too.
 */
export function mountAvatars(app: Hono<GeekityEnv>): void {
  app.get(`${AVATAR_PATH_PREFIX}:key`, async (c) => {
    const source = avatarSourceOf(c.req.param('key'));
    const answer =
      source === undefined ? ({ kind: 'unknown' } as const) : await c.var.avatars.answer(source);

    switch (answer.kind) {
      case 'unknown':
        return c.text('Not Found', 404);
      case 'placeholder':
        return new Response(AVATAR_PLACEHOLDER_SVG, {
          headers: {
            'content-type': 'image/svg+xml',
            'cache-control': `public, max-age=${String(AVATAR_PLACEHOLDER_MAX_AGE_SECONDS)}`,
          },
        });
      case 'image': {
        const options = { maxAge: AVATAR_MAX_AGE_SECONDS };
        return matchesEtag(c.req.header('if-none-match'), answer.asset.etag)
          ? assetNotModified(answer.asset, options)
          : assetResponse(answer.asset, options);
      }
    }
  });
}
