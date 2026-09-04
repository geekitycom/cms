/**
 * An Eleventy 3 config that builds a Geekity content directory.
 *
 * Copy this to `eleventy.config.js` in the root of your site and run
 * `npx @11ty/eleventy`. The same `content/` directory that the CMS serves
 * becomes a static site at the same URLs, which is the promise this file
 * exists to keep: nothing here is Geekity-specific magic, only the four rules
 * the CMS follows written out in Eleventy's own terms.
 *
 * 1. `draft: true` hides a document.
 * 2. A document with no `permalink` gets the CMS default:
 *    `/{yyyy}/{mm}/{slug}/` for posts, `/{slug}/` for pages.
 * 3. `content/uploads/` is copied through to `/uploads/`.
 * 4. `content/_trash/` is not built.
 * 5. `categories`, the CMS's second taxonomy, becomes `collections.categories`.
 *
 * You supply the layouts. The directory data files name them — `posts.json`
 * says `"layout": "post"`, `pages.json` says `"layout": "page"` — so
 * `content/_includes/post.njk` and `content/_includes/page.njk` need to exist.
 *
 * This file has no dependencies beyond Eleventy itself, so it stays copyable.
 * It is not part of the published package; it lives in the repository, and the
 * package's `test:11ty` suite builds the test fixtures with it to prove the
 * URLs still match.
 */

/** The content subdirectory that holds dated posts; everything else is a page. */
const POSTS_DIRECTORY = 'posts';

/**
 * Letters that Unicode decomposition leaves alone, spelled out before the
 * ASCII filter throws them away. Mirrors `slugify` in the CMS.
 */
const TRANSLITERATIONS = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/đ|ð/g, 'd'],
  [/ł/g, 'l'],
  [/þ/g, 'th'],
  [/ħ/g, 'h'],
  [/ı/g, 'i'],
  [/ŋ/g, 'n'],
];

/** Turn a title into a URL slug: lowercase ASCII letters, digits and hyphens. */
function slugify(title) {
  let value = String(title).normalize('NFKD').toLowerCase();

  for (const [pattern, replacement] of TRANSLITERATIONS) {
    value = value.replace(pattern, replacement);
  }

  return value
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The year and month a post is filed under, read from the date as written
 * rather than shifted into UTC: a post published at 00:30 on 1 October in
 * Berlin belongs to October.
 */
function yearAndMonth(date) {
  if (typeof date === 'string') {
    const match = /^(\d{4})-(\d{2})/.exec(date);
    if (match) return { year: match[1], month: match[2] };
  }

  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return undefined;

  return {
    year: String(parsed.getUTCFullYear()).padStart(4, '0'),
    month: String(parsed.getUTCMonth() + 1).padStart(2, '0'),
  };
}

/** One document's `categories`, which Eleventy hands over as written. */
function categoriesOf(data) {
  const value = data?.categories;
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (!Array.isArray(value)) return [];
  return value.filter((category) => typeof category === 'string' && category !== '');
}

/** Whether a content-relative input path is a post rather than a page. */
function isPost(inputPath) {
  return String(inputPath).split('/').includes(POSTS_DIRECTORY);
}

/**
 * The permalink the CMS would compute for a document whose front matter has
 * none. Returns undefined when there is nothing to compute it from, in which
 * case Eleventy falls back to its own filename-based URL.
 */
function defaultPermalink(data) {
  const slug = slugify(data.title ?? '') || data.page?.fileSlug;
  if (!slug) return undefined;

  if (!isPost(data.page?.inputPath ?? '')) return `/${slug}/`;

  // `data.date` is what the file wrote; `page.date` is Eleventy's parse of it.
  const filed = yearAndMonth(data.date ?? data.page?.date);
  if (!filed) return undefined;

  return `/${filed.year}/${filed.month}/${slug}/`;
}

export default function (eleventyConfig) {
  // `draft: true` is the CMS's only status flag. Set BUILD_DRAFTS=1 to preview
  // them locally.
  eleventyConfig.addPreprocessor('geekity-drafts', '*', (data) => {
    if (data.draft === true && !process.env.BUILD_DRAFTS) return false;
  });

  // The CMS writes `permalink` into every file it saves, so this only matters
  // for hand-authored files. Front matter always wins.
  eleventyConfig.addPreprocessor('geekity-permalinks', 'md', (data) => {
    if (typeof data.permalink === 'string' && data.permalink !== '') return;

    const permalink = defaultPermalink(data);
    if (permalink !== undefined) data.permalink = permalink;
  });

  // Eleventy builds a collection from every value of `tags` by itself. The
  // CMS's second taxonomy, `categories`, is an ordinary data key to Eleventy,
  // so this exposes it: `collections.categories` holds one entry per category
  // in use, `{ name, posts }`, sorted by name with each category's documents
  // newest first — the order the CMS's own archive at `/category/{name}/`
  // serves them in.
  //
  // Paginate it to build those archives:
  //
  //     ---
  //     pagination:
  //       data: collections.categories
  //       size: 1
  //       alias: category
  //     permalink: "/category/{{ category.name | urlencode }}/"
  //     ---
  //     {% for post in category.posts %}…{% endfor %}
  eleventyConfig.addCollection('categories', (collectionApi) => {
    const byCategory = new Map();

    for (const item of collectionApi.getAll()) {
      for (const category of categoriesOf(item.data)) {
        const posts = byCategory.get(category) ?? [];
        posts.push(item);
        byCategory.set(category, posts);
      }
    }

    return [...byCategory.keys()].sort().map((name) => ({
      name,
      posts: (byCategory.get(name) ?? [])
        .slice()
        .sort((a, b) => Number(b.date ?? 0) - Number(a.date ?? 0)),
    }));
  });

  // Documents are Markdown; Nunjucks and HTML are here for the layouts and for
  // any index pages you write by hand.
  eleventyConfig.setTemplateFormats(['md', 'njk', 'html']);

  // Uploads are files, not templates: copy them through unchanged. The ignore
  // matters as much as the copy — the CMS only ever indexes `posts/` and
  // `pages/`, so a Markdown file that happens to be an upload is something to
  // download, not a page Eleventy should render at a URL of its own.
  eleventyConfig.addPassthroughCopy({ 'content/uploads': 'uploads' });
  eleventyConfig.ignores.add('content/uploads/**');

  // Eleventy ignores `_includes` and `_data` because they are configured
  // directories; every other underscore directory is built unless it is
  // ignored, and the CMS keeps deleted documents in `content/_trash/`.
  eleventyConfig.ignores.add('content/_trash/**');

  return {
    dir: {
      input: 'content',
      output: '_site',
      includes: '_includes',
      data: '_data',
    },
    // Markdown is rendered as Markdown, not as a template. The CMS renders it
    // with markdown-it and no template engine, so leaving Liquid or Nunjucks on
    // here would let `{{ … }}` in a post mean two different things.
    markdownTemplateEngine: false,
    htmlTemplateEngine: 'njk',
  };
}
