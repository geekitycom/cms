import { slugify } from '../content/slug.ts';
import type { PermalinkBases } from '../content/taxonomy.ts';
import { newWikiPagePath } from '../site/admin-paths.ts';

/** The page a theme's 404 offers a signed-in writer to create. */
export interface CreateWikiPage {
  /** The title the editor opens with, made from the slug. */
  readonly title: string;
  /** The wiki editor with the slug and the title filled in. */
  readonly url: string;
}

/**
 * The wiki page a writer could create at `pathname`, or `undefined` when the
 * path is not a wiki page's address.
 *
 * Only a slug that slugifies to itself is offered, because that is the slug
 * the editor would save under and so the only one that lands back at this URL.
 */
export function createWikiPageAt(
  bases: Pick<PermalinkBases, 'wiki'>,
  pathname: string,
): CreateWikiPage | undefined {
  const prefix = `/${bases.wiki}/`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith('/')) return undefined;
  const slug = pathname.slice(prefix.length, -1);
  if (slug === '' || slugify(slug) !== slug) return undefined;
  const title = titleFromSlug(slug);
  return { title, url: newWikiPagePath(slug, title) };
}

/** `potting-shed` as `Potting shed`: dashes to spaces, the first letter capitalised. */
function titleFromSlug(slug: string): string {
  const words = slug.replaceAll('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
