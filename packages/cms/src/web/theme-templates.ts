import { findThemeFile } from '../theme/themes.ts';

/** Templates the default theme ships and the public routes ask for by name. */
export const TEMPLATES = {
  home: 'layouts/home.njk',
  post: 'layouts/post.njk',
  page: 'layouts/page.njk',
  tag: 'layouts/tag.njk',
  category: 'layouts/category.njk',
  author: 'layouts/author.njk',
  search: 'layouts/search.njk',
  comment: 'layouts/comment.njk',
  notFound: 'layouts/404.njk',
  gone: 'layouts/410.njk',
  serverError: 'layouts/500.njk',
  maintenance: 'layouts/503.njk',
} as const;

/**
 * The two templates named for the Reading choice, which a theme may write and
 * which fall back to an ordinary layout when it has not.
 *
 * They are WordPress's own `front-page.php` and `home.php`, and they exist for
 * the same reason: a front page is often the one page of a site that looks
 * like nothing else, and saying so should not mean overriding the layout every
 * other page uses. The default theme ships `front-page.njk` and no
 * posts page layout, so a site that sets a posts page gets the listing layout
 * until it writes one.
 */
export const OPTIONAL_TEMPLATES = {
  /**
   * The front page alone. The default theme ships one, so the
   * fallback is only reached by a theme that replaced it with nothing.
   */
  frontPage: 'layouts/front-page.njk',
  /** The listing on the posts page. Falls back to {@link TEMPLATES.home}. */
  postsPage: 'layouts/posts-page.njk',
} as const;

export interface TextTemplates {
  readonly markdown: string;
  readonly gemini: string;
}

export const CHROME_TEMPLATES = {
  header: { markdown: 'partials/markdown-header.md.njk', gemini: 'partials/gemini-header.gmi.njk' },
  footer: { markdown: 'partials/markdown-footer.md.njk', gemini: 'partials/gemini-footer.gmi.njk' },
} as const satisfies Record<string, TextTemplates>;

export interface StatusPage extends TextTemplates {
  readonly template: string;
  readonly title: string;
}

export const STATUS_PAGES = {
  notFound: {
    template: TEMPLATES.notFound,
    markdown: 'layouts/404.md.njk',
    gemini: 'layouts/404.gmi.njk',
    title: 'Not found',
  },
  gone: {
    template: TEMPLATES.gone,
    markdown: 'layouts/410.md.njk',
    gemini: 'layouts/410.gmi.njk',
    title: 'Deleted',
  },
  serverError: {
    template: TEMPLATES.serverError,
    markdown: 'layouts/500.md.njk',
    gemini: 'layouts/500.gmi.njk',
    title: 'Something went wrong',
  },
  maintenance: {
    template: TEMPLATES.maintenance,
    markdown: 'layouts/503.md.njk',
    gemini: 'layouts/503.gmi.njk',
    title: 'Down for maintenance',
  },
} as const satisfies Record<string, StatusPage>;

export type StatusPageName = keyof typeof STATUS_PAGES;

export function untilContext(until: Date | undefined): Record<string, string> {
  return until === undefined ? {} : { until: until.toISOString(), untilText: until.toUTCString() };
}

/**
 * `preferred` when a theme in the search path ships it, and `fallback`
 * otherwise.
 *
 * Asked per render rather than at boot, so adding `front-page.njk` to a theme
 * shows on the next request exactly as editing one does. It costs one `stat`
 * per theme directory, and only on the two pages that have an override point
 * at all.
 */
export function themeTemplate(
  themeDirs: readonly string[],
  preferred: string,
  fallback: string,
): string {
  return findThemeFile(themeDirs, preferred) === undefined ? fallback : preferred;
}

export function writesGemtext(dirs: readonly string[], templates: TextTemplates): boolean {
  for (const dir of dirs) {
    if (findThemeFile([dir], templates.gemini) !== undefined) return true;
    if (findThemeFile([dir], templates.markdown) !== undefined) return false;
  }
  return false;
}
