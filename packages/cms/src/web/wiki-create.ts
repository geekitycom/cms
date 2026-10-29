import { isCanonicalSlug } from '../content/slug.ts';
import type { PermalinkBases } from '../content/taxonomy.ts';
import { newWikiPagePath } from '../site/admin-paths.ts';

/** The page a theme's 404 offers a signed-in writer to create. */
export interface CreateWikiPage {
  /** The title the editor opens with, made from the slug. */
  readonly title: string;
  /** The wiki editor with the slug and the title filled in. */
  readonly url: string;
}

export function createWikiPageAt(
  bases: Pick<PermalinkBases, 'wiki'>,
  pathname: string,
): CreateWikiPage | undefined {
  const prefix = `/${bases.wiki}/`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith('/')) return undefined;
  const slug = pathname.slice(prefix.length, -1);
  if (slug === '' || !isCanonicalSlug(slug)) return undefined;
  const title = titleFromSlug(slug);
  return { title, url: newWikiPagePath(slug, title) };
}

function titleFromSlug(slug: string): string {
  const words = slug.replaceAll('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
