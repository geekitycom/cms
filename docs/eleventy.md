# Building the same content with Eleventy

The content directory is an [Eleventy](https://www.11ty.dev) 3 input directory.
The same files this CMS serves build into a static site at the same URLs, so
leaving is a build step rather than a migration. That is a promise, and it is
kept by a test rather than by good intentions.

Copy
[`docs/eleventy.config.example.js`](../packages/cms/docs/eleventy.config.example.js)
into your site as `eleventy.config.js` and run Eleventy:

```sh
npm install --save-dev @11ty/eleventy
npx @11ty/eleventy
```

It is a plain ESM config with no dependency on this package, and it writes out
the rules the CMS follows that Eleventy does not know about on its own:

| Rule                                            | How the config does it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draft: true` hides a document                  | An `addPreprocessor` that returns `false` for it. `BUILD_DRAFTS=1` builds drafts anyway, for a local preview.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `visibility: unlisted` is listed nowhere        | An `addPreprocessor` that sets `eleventyExcludeFromCollections` on the document, so a feed, sitemap or archive drawn from collections leaves it out, and sets `noindex` for the layout to print as `<meta name="robots" content="noindex">`. Any value other than `public` or `unlisted` returns `false`, as a draft does.                                                                                                                                                                                          |
| A file with no `permalink` gets the CMS default | An `addPreprocessor` that fills in `/{yyyy}/{mm}/{slug}/` for a post and `/{slug}/` for a page, slugifying the title exactly as the CMS does. Front matter always wins; the CMS writes `permalink` into every file it saves, so this only matters for hand-authored files.                                                                                                                                                                                                                                          |
| `content/uploads/` is served at `/uploads/`     | `addPassthroughCopy({ 'content/uploads': 'uploads' })`, plus an `ignores` entry for the same path. Without the ignore, an upload that happens to be Markdown would be copied _and_ rendered as a page; the CMS only ever indexes `posts/` and `pages/`.                                                                                                                                                                                                                                                             |
| `content/_data/federation/` is data             | `followers.json` is an ordinary data file in a namespaced `_data` subdirectory, so Eleventy hands it over as `federation.followers` without being told. The monthly inbox logs are JSON Lines, which Eleventy has no reader for, so the config registers one with `addDataExtension('jsonl', …)`: each month becomes an entry of `federation.inbox`, keyed by its `{yyyy}-{mm}` name.                                                                                                                               |
| `content/_data/comments/` is the same thread    | The conversation under a post is not only the inbox log: the approved comments in `content/_data/comments/{slug}.json` thread with it. The `conversation` filter takes the post's slug as a second argument and reads that file directly, rather than through the data cascade — a namespaced `_data/comments/` directory would arrive as a global called `comments`, and `comments: true` in a post's front matter would shadow it on exactly the pages that need it. The slug is on the context as `geekitySlug`. |
| `content/_trash/` is not published              | `ignores.add('content/_trash/**')`. Eleventy skips `_includes` and `_data` because they are configured directories, not because of the underscore, so the trash has to be named.                                                                                                                                                                                                                                                                                                                                    |
| Dates are shown in the site's `timezone`        | A `date` filter with the CMS's four formats: `readable`, `html` and `year` are the calendar the site's zone was on at the instant, `iso` is the instant in UTC. The zone is read from `content/_data/site.json`, which the settings screen writes, so a zone changed in the CMS changes the built pages too.                                                                                                                                                                                                        |
| A future `date` holds a post back               | An `addPreprocessor` that returns `false` for it. This is the one rule that cannot be exactly the same in both places: a build has no clock, only a moment. A scheduled post is left out of the build that runs before its date and is in the next build after it, so a scheduled site needs a build on a schedule; the CMS publishes it on the date by itself. `BUILD_SCHEDULED=1` builds them anyway.                                                                                                             |

It also builds two collections Eleventy has no notion of. `collections.categories`
is the second taxonomy, one entry of `{ name, posts }` per category in use, for
paginating into archives at `/{{ site.categoryBase }}/{name}/`.
`collections.menus` is the site's named menus — the `menus` object of
`site.json`, and nothing else — each an ordered list of `{ label, url }`
entries, plus `rel` on a link that carries `rel` values; a layout
marks the current one itself by comparing `item.url` with `page.url`, because a
collection is built once for the whole site.

The `date` filter is the one that needs a word. The files hold UTC instants and
the `timezone` setting decides how they read, so the config's filter takes the
zone from `content/_data/site.json` — the file the settings screen writes —
and renders with `Intl`, which keeps the file free of dependencies. If your site
already uses [Luxon](https://moment.github.io/luxon/), which Eleventy ships
anyway, the same filter is shorter:

```js
import { DateTime } from 'luxon';

const zone =
  JSON.parse(readFileSync('content/_data/site.json', 'utf8')).timezone ?? 'utc';

eleventyConfig.addFilter('date', (value, format = 'readable') => {
  const at = DateTime.fromJSDate(
    value instanceof Date ? value : new Date(value),
  ).setZone(zone);
  if (!at.isValid) return '';

  // `iso` is the instant, never the zone: a <time datetime> and a feed want
  // UTC and must not move when a setting does.
  if (format === 'iso') return at.toUTC().toISO();
  if (format === 'html') return at.toFormat('yyyy-MM-dd');
  if (format === 'year') return at.toFormat('yyyy');
  return at.toFormat('d LLLL yyyy');
});
```

Either way it is the CMS's own filter, format for format, so a layout moved
across prints the same dates.

It also turns the template engine off for Markdown
(`markdownTemplateEngine: false`), because the CMS renders Markdown with
markdown-it and nothing else. Leaving Liquid or Nunjucks on would make `{{ … }}`
in a post mean one thing on the live site and another in the build.

Layouts are yours. The directory data files name them — `posts.json` says
`"layout": "post"` and `pages.json` says `"layout": "page"` — so Eleventy wants
`content/_includes/post.njk` and `content/_includes/page.njk`. The context an
Eleventy layout receives is the one this package's theme mirrors, so a layout
can often be moved across with only its `{% extends %}` removed.

The default theme's own layouts and partials build too, copied into
`content/_includes/` as `layouts/` and `partials/`: the config adds the theme's
other filters (`absoluteUrl`, `asset`, `host`, `fediverseHandle`) and the
`newestPosts(count)` a front page override lists posts with, so a site theme's
`front-page.njk` calling `{% set posts = newestPosts(5) %}` builds. They get
only the context the config gives, though: `collections.menus` rather than
`menus`, the `conversation` filter rather than the key, and no comment form,
search or listing pagination.

Some things do not carry over. `/feed/`, `/feed/atom/` and `/feed/json/` are
generated in code here, not by a template, so an Eleventy build needs its own;
`/sitemap.xml` and `/robots.txt` are the same story, for the same reason. A
comment's own page at `/comment/{key}/` is not written, since a build has no
server to take a comment, so a comment links to its `#comment-{key}` anchor on
the post. The site's own reply posts are not threaded under what they answer,
and a document's backlinks are not listed: both read the CMS's index of every
document, which the config's filters do not have. The config's header lists
the same.

## The compatibility test

```sh
pnpm --filter @geekity/cms test:11ty   # or, from the repository root, pnpm test:11ty
```

`test:11ty` builds `test/fixtures/` with Eleventy 3 and the example config, then
checks every document against what the CMS computed for the same file: the
output path equals the permalink plus `index.html`, drafts and the trash are
absent, and uploads are copied through byte for byte. The fixtures deliberately
cover a post whose permalink is not the default, a hand-authored post and page
with no permalink at all, an accented title, a draft and a trashed file.

It is a separate script from `pnpm test` on purpose. The unit suite stays fast
and free of a build tool; `test:11ty` pulls in Eleventy, writes a temporary
directory and is the slow one. CI runs both. Neither `docs/` nor `test/` is in
the published tarball — the example config lives in the repository, which is
where you copy it from.

The repository's demo site makes the same comparison over content that reads
like a real site rather than like fixtures, with the two layouts above in
`apps/demo/content/_includes/`, so `pnpm test:11ty` from the root runs both.
