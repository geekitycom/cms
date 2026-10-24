import { findThemeFile } from '../theme/themes.ts';

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

export const OPTIONAL_TEMPLATES = {
  frontPage: 'layouts/front-page.njk',
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
