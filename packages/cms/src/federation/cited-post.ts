import type { Context } from '@fedify/fedify';
import { Article, Document, Image, isActor, Note, Page, Question } from '@fedify/vocab';
import type { Link } from '@fedify/vocab';

import type { FediverseLookup, FediversePost } from '../webmention/reply-context.ts';
import type { FederationContextData } from './federation.ts';
import { profileFrom } from './profiles.ts';
import { siteLoaders } from './site-loaders.ts';

/**
 * The site's {@link FediverseLookup} (TASK-199): the fediverse post a cited
 * page links as its ActivityPub alternate, read as the site with
 * {@link siteLoaders}, with the author it is attributed to.
 *
 * A post behind a content warning shows the warning, not its words or its
 * picture, as a fediverse client would before the reader opens it.
 */
export function citedPostReader(contextOf: () => Context<FederationContextData>): FediverseLookup {
  return async (url, signal) => {
    const context = contextOf();
    const loaders = await siteLoaders(context, signal);
    const object = await context.lookupObject(url, { ...loaders, signal });
    if (
      !(object instanceof Note) &&
      !(object instanceof Article) &&
      !(object instanceof Page) &&
      !(object instanceof Question)
    ) {
      return undefined;
    }

    const attributed = await object.getAttribution({ ...loaders, suppressError: true });
    const profile = isActor(attributed) ? await profileFrom(attributed, loaders) : undefined;
    const handle = profile?.handle?.replace(/^@/, '');
    const authorName = profile?.name ?? handle;
    const warning = object.summary?.toString() ?? '';
    const hidden = warning !== '' || object.sensitive === true;
    const image = hidden ? undefined : await firstImage(object, loaders);
    const shownAt = hrefOf(object.url);

    return {
      ...(object.name === null ? {} : { name: object.name.toString() }),
      ...(warning !== ''
        ? { html: `<p>${escapeHtml(warning)}</p>` }
        : object.content === null
          ? {}
          : { html: object.content.toString() }),
      ...(profile === undefined || authorName === undefined
        ? {}
        : {
            author: {
              name: authorName,
              ...(profile.url === null ? {} : { url: profile.url }),
              ...(handle === undefined ? {} : { handle }),
              ...(profile.iconUrl === null ? {} : { photo: profile.iconUrl }),
            },
          }),
      ...(object.published === null ? {} : { published: object.published.toString() }),
      ...(image === undefined ? {} : { image }),
      ...(shownAt === undefined ? {} : { url: shownAt }),
    } satisfies FediversePost;
  };
}

async function firstImage(
  object: Note | Article | Page | Question,
  loaders: Awaited<ReturnType<typeof siteLoaders>>,
): Promise<string | undefined> {
  for await (const attachment of object.getAttachments({ ...loaders, suppressError: true })) {
    if (!(attachment instanceof Document)) continue;
    if (!(attachment instanceof Image) && !(attachment.mediaType ?? '').startsWith('image/')) {
      continue;
    }
    const href = hrefOf(attachment.url);
    if (href !== undefined) return href;
  }
  return undefined;
}

function hrefOf(value: URL | Link | null): string | undefined {
  if (value === null) return undefined;
  return value instanceof URL ? value.href : value.href?.href;
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
