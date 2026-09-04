/**
 * An Eleventy 3 config that builds a Geekity content directory.
 *
 * Copy this to `eleventy.config.js` in the root of your site and run
 * `npx @11ty/eleventy`. The same `content/` directory that the CMS serves
 * becomes a static site at the same URLs, which is the promise this file
 * exists to keep: nothing here is Geekity-specific magic, only the rules the
 * CMS follows written out in Eleventy's own terms.
 *
 * 1. `draft: true` hides a document.
 * 2. A `date` in the future holds a post back until it arrives.
 * 3. A document with no `permalink` gets the CMS default:
 *    `/{yyyy}/{mm}/{slug}/` for posts, `/{slug}/` for pages.
 * 4. `content/uploads/` is copied through to `/uploads/`.
 * 5. `content/_trash/` is not built.
 * 6. `categories`, the CMS's second taxonomy, becomes `collections.categories`.
 * 7. The site menu becomes `collections.menu`.
 * 8. A `date` filter that reads a UTC instant through `site.timezone`.
 * 9. `content/_data/federation/` — the followers and the inbox log — is data.
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

import { readFileSync } from 'node:fs';

/** The content subdirectory that holds dated posts; everything else is a page. */
const POSTS_DIRECTORY = 'posts';

/**
 * The zone the CMS shows its dates in.
 *
 * Dates in the files are UTC instants; the `timezone` setting is the lens they
 * are read through, and the settings screen mirrors it into `site.json`. It is
 * read here rather than off the template context because a filter's `this`
 * differs between Eleventy's template engines and a build has one site.
 */
function siteTimezone() {
  try {
    const site = JSON.parse(readFileSync('content/_data/site.json', 'utf8'));
    return typeof site.timezone === 'string' && site.timezone !== '' ? site.timezone : 'UTC';
  } catch {
    return 'UTC';
  }
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The calendar day a zone was on at an instant, `YYYY-MM-DD`. */
function calendarDayIn(date, zone) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

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
  // The CMS's `date` filter, in Eleventy's terms: `readable` (the default),
  // `html` and `year` are the calendar the site's own zone is on, and `iso` is
  // the instant, because a <time datetime> and a feed want UTC and must not
  // move when a setting does. Pass a zone as the second argument to override.
  //
  // With Luxon — which Eleventy already ships — the same filter reads:
  //
  //     const at = DateTime.fromJSDate(new Date(value)).setZone(zone ?? siteTimezone());
  //     return { iso: at.toUTC().toISO(), html: at.toFormat('yyyy-MM-dd'),
  //              year: at.toFormat('yyyy') }[format] ?? at.toFormat('d LLLL yyyy');
  //
  // This version uses Intl so the file keeps its promise of no dependencies.
  const defaultZone = siteTimezone();
  eleventyConfig.addFilter('date', (value, format = 'readable', zone = defaultZone) => {
    const at = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(at.getTime())) return '';
    if (format === 'iso') return at.toISOString();

    const [year, month, day] = calendarDayIn(at, zone).split('-');
    if (format === 'html') return `${year}-${month}-${day}`;
    if (format === 'year') return year;
    return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
  });

  // The CMS publishes its ActivityPub followers and the log of what its inbox
  // was told under `content/_data/federation/` (decision-9), so a build of the
  // same directory can show them. Eleventy reads `followers.json` by itself —
  // it is a data file in a namespaced `_data` subdirectory, so it arrives as
  // `federation.followers` — but the inbox log is JSON Lines, one activity per
  // line, which Eleventy has no reader for. This is that reader: each month
  // file becomes an entry of `federation.inbox`, keyed by its `{yyyy}-{mm}`
  // name and holding an array of compact JSON-LD activities, each with the
  // `receivedAt` the log stamped it with.
  //
  //     {% for follower in federation.followers %}{{ follower.handle }}{% endfor %}
  //     {% for month, activities in federation.inbox %}…{% endfor %}
  //
  // A blank line is skipped; a line that will not parse fails the build, which
  // is the same thing the CMS does with it.
  eleventyConfig.addDataExtension('jsonl', (contents) =>
    contents
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line)),
  );

  // `draft: true` is the CMS's only status flag. Set BUILD_DRAFTS=1 to preview
  // them locally.
  eleventyConfig.addPreprocessor('geekity-drafts', '*', (data) => {
    if (data.draft === true && !process.env.BUILD_DRAFTS) return false;
  });

  // A post dated in the future is scheduled: the CMS holds it until its date
  // and publishes it then. A build has no clock, only the moment it ran, so the
  // nearest equivalent is to leave a future-dated post out of this build and
  // let the next build after its date pick it up — which means a site with
  // scheduled posts needs a build on a schedule. Set BUILD_SCHEDULED=1 to
  // include them anyway.
  eleventyConfig.addPreprocessor('geekity-scheduled', '*', (data) => {
    if (process.env.BUILD_SCHEDULED) return;

    const date = data.date ?? data.page?.date;
    if (date === undefined || date === null) return;

    const at = date instanceof Date ? date : new Date(date);
    if (!Number.isNaN(at.getTime()) && at.getTime() > Date.now()) return false;
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
  // newest first — the order the CMS's own archive serves them in.
  //
  // Paginate it to build those archives. The base comes from `site.json`, which
  // the settings screen mirrors, so a base changed in the CMS moves the built
  // archives too:
  //
  //     ---
  //     pagination:
  //       data: collections.categories
  //       size: 1
  //       alias: category
  //     permalink: "/{{ site.categoryBase or 'category' }}/{{ category.name | urlencode }}/"
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

  // The site menu. The CMS puts it on every template as `menu`; here it is
  // `collections.menu`, because a collection is the only place a build can see
  // both the global data and every page at once.
  //
  // It is the `navigation` array of `content/_data/site.json`, which the
  // settings screen mirrors, followed by every page whose front matter says
  // `navigation: true`, ordered by `navigationOrder` and then by title. Each
  // entry is `{ label, url }`; a layout marks the current one itself, because a
  // collection is built once for the whole site and `page.url` is per template:
  //
  //     {% for item in collections.menu %}
  //     <a href="{{ item.url }}"
  //        {% if item.url == page.url %}aria-current="page"{% endif %}>{{ item.label }}</a>
  //     {% endfor %}
  eleventyConfig.addCollection('menu', (collectionApi) => {
    const all = collectionApi.getAll();
    const site = all[0]?.data?.site ?? {};

    const items = (Array.isArray(site.navigation) ? site.navigation : [])
      .filter(
        (item) =>
          item &&
          typeof item.label === 'string' &&
          item.label !== '' &&
          typeof item.url === 'string' &&
          item.url !== '',
      )
      .map((item) => ({ label: item.label, url: item.url }));

    const pages = all
      .filter((item) => item.data.navigation === true && !isPost(item.data.page?.inputPath ?? ''))
      .map((item) => ({
        label: String(item.data.title ?? ''),
        url: item.url,
        order:
          typeof item.data.navigationOrder === 'number' &&
          Number.isFinite(item.data.navigationOrder)
            ? item.data.navigationOrder
            : Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
      .map(({ label, url }) => ({ label, url }));

    return [...items, ...pages];
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

  // The CMS's derived image variants are NOT copied and NOT ignored here,
  // because there is nothing to ignore: they live in `data/images/`, outside
  // this build's input directory, and they are disposable state the CMS
  // rebuilds on demand (decision-9, decision-10). A build makes its own.
  //
  // To get the markup the CMS serves — a <picture> with a WebP <source> and an
  // <img> carrying srcset, sizes, width, height and loading="lazy" — run
  // @11ty/eleventy-img over the same originals, at the same widths:
  //
  //     import { eleventyImageTransformPlugin } from '@11ty/eleventy-img';
  //
  //     eleventyConfig.addPlugin(eleventyImageTransformPlugin, {
  //       widths: [320, 640, 960, 1280, 1920],
  //       formats: ['webp', 'auto'],
  //       defaultAttributes: { loading: 'lazy', sizes: '100vw' },
  //     });
  //
  // It is left out of this file rather than switched on, because this config
  // promises to have no dependencies beyond Eleventy itself.

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
