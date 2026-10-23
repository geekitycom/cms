import type { Hono } from 'hono';

import { FONT_PATH_PREFIX } from '../fonts/index.ts';
import {
  ASSET_VERSION_PARAM,
  IMMUTABLE_ASSET,
  assetNotModified,
  assetResponse,
  assetVersion,
  matchesEtag,
} from '../theme/assets.ts';
import type { GeekityEnv } from './env.ts';
import { notFound } from './status-pages.ts';

/**
 * Register the route the hosted Google Fonts are served from (decision-61),
 * under `/_geekity/` so no permalink can take it. Only the files the font
 * store wrote are answered: a stylesheet and the WOFF2 files it names.
 *
 * A font file is named by the hash of its bytes, so it is cached for a year.
 * A stylesheet is cached for a year when its `v` is the hash of its bytes, as
 * a theme asset is, and for the theme's short lifetime otherwise.
 */
export function mountFonts(app: Hono<GeekityEnv>): void {
  app.get(`${FONT_PATH_PREFIX}:slug/:file`, (c) => {
    const name = c.req.param('file');
    const asset = c.var.fonts.file(c.req.param('slug'), name);
    if (asset === undefined) return notFound(c);

    const version = assetVersion(asset);
    const fingerprinted =
      name === `${version}.woff2` || c.req.query(ASSET_VERSION_PARAM) === version;
    const options = fingerprinted ? IMMUTABLE_ASSET : {};
    return matchesEtag(c.req.header('if-none-match'), asset.etag)
      ? assetNotModified(asset, options)
      : assetResponse(asset, options);
  });
}
