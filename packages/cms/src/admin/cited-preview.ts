import type { Context, Hono } from 'hono';

import { CITATION_PROPERTIES, citedHost, citesAnImage, shownInFull } from '../content/citation.ts';
import type { CitedPage } from '../content/citation.ts';
import { isWebUrl } from '../content/enclosure.ts';
import { ADMIN_PREFIX } from '../site/admin-paths.ts';
import { trimmedField } from '../util/forms.ts';
import type { GeekityEnv } from '../web/env.ts';
import type { CitedPicture } from '../webmention/cited-picture.ts';
import type { AdminRender } from './documents.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

export const CITED_PREVIEW_PATH = `${ADMIN_PREFIX}/cited-preview`;

const CITING_PROPERTIES: readonly string[] = ['in-reply-to', ...CITATION_PROPERTIES];

/** What the editor shows under one cited address. */
export type CitedCardView =
  | {
      readonly name: string;
      readonly author?: string | undefined;
      readonly picture?: CitedPicture | undefined;
      readonly described: boolean;
    }
  | { readonly unread: true; readonly name: string };

export function citedCardView(
  property: string,
  url: string,
  context: (CitedPage & { readonly picture?: CitedPicture | undefined }) | undefined,
): CitedCardView {
  if (context === undefined) return { unread: true, name: `a page on ${citedHost(url)}` };
  const image = citesAnImage(context);
  const { picture } = context;
  return {
    name:
      context.name ??
      context.author?.name ??
      `${image ? 'An image from' : 'A page on'} ${citedHost(url)}`,
    author: context.name === undefined ? undefined : context.author?.name,
    picture,
    described: image && picture !== undefined && shownInFull(property, picture),
  };
}

/**
 * Read a page an address field in the editor names, before any save, and
 * answer with the card the editor draws under that field.
 */
export function mountCitedPreview(
  app: Hono<GeekityEnv>,
  { render }: { render: AdminRender },
): void {
  app.post(CITED_PREVIEW_PATH, async (c) => {
    const body = await c.req.parseBody();
    const property = trimmedField(body, 'property');
    const url = trimmedField(body, 'url');
    if (!CITING_PROPERTIES.includes(property) || !isWebUrl(url)) {
      return c.text('Give a web address and the field it is in.', 400);
    }
    return render(c, ADMIN_TEMPLATES.citedPreview, {
      property,
      citedPreviews: { [property]: citedCardView(property, url, await contextOf(c, url)) },
      form: { previewHidden: false, citedAlt: '', title: '' },
    });
  });
}

async function contextOf(c: Context<GeekityEnv>, url: string) {
  const { replyContexts, siteAtRequestStart } = c.var;
  return replyContexts.read(url, siteAtRequestStart) ?? (await replyContexts.readNow(url));
}
