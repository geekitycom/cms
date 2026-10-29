# Building the same content with Eleventy

The content directory is an [Eleventy](https://www.11ty.dev) 3 input directory.
The files this CMS serves build into a static site at the same URLs. To leave
the CMS, you run a build. You do not migrate content. A test checks this
promise.

Copy
[`docs/eleventy.config.example.js`](../packages/cms/docs/eleventy.config.example.js)
into your site as `eleventy.config.js` and run Eleventy:

```sh
npm install --save-dev @11ty/eleventy
npx @11ty/eleventy
```

The file is a plain ESM config with no dependency on this package. It
implements the CMS rules that Eleventy does not know on its own:

| Rule                                            | How the config does it                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draft: true` hides a document                  | An `addPreprocessor` returns `false` for the document. `BUILD_DRAFTS=1` builds drafts anyway, for a local preview.                                                                                                                                                                                                                                                                                                                                                                              |
| `visibility: unlisted` is listed nowhere        | An `addPreprocessor` sets `eleventyExcludeFromCollections` on the document, so a feed, sitemap or archive built from collections leaves it out. It also sets `noindex`, which the layout prints as `<meta name="robots" content="noindex">`. Any value other than `public` or `unlisted` returns `false`, the same as a draft.                                                                                                                                                                  |
| A file with no `permalink` gets the CMS default | An `addPreprocessor` fills in `/{yyyy}/{mm}/{slug}/` for a post and `/{slug}/` for a page. It slugifies the title the same way the CMS does. Front matter always wins. The CMS writes `permalink` into every file it saves, so this rule matters only for hand-authored files.                                                                                                                                                                                                                  |
| A wiki page is at `/{wikiBase}/{slug}/`         | The same preprocessor gives a file under `wiki/` the permalink `/{wikiBase}/{slug}/`, where the slug is its file name slugified and `wikiBase` comes from `site.json`, `wiki` by default. It overrides any `permalink` in the file, as the CMS ignores one.                                                                                                                                                                                                                                     |
| `content/uploads/` is served at `/uploads/`     | `addPassthroughCopy({ 'content/uploads': 'uploads' })`, plus an `ignores` entry for the same path. Without the ignore, an upload that is a Markdown file would be copied _and_ rendered as a page. The CMS indexes only `posts/`, `pages/` and `wiki/`.                                                                                                                                                                                                                                         |
| `content/_data/federation/` is data             | `followers.json` is an ordinary data file in a namespaced `_data` subdirectory. Eleventy provides it as `federation.followers` with no extra config. The monthly inbox logs are JSON Lines, and Eleventy has no reader for them. The config registers one with `addDataExtension('jsonl', …)`. Each month becomes an entry of `federation.inbox`, keyed by its `{yyyy}-{mm}` name.                                                                                                              |
| `content/_data/comments/` is the same thread    | The conversation under a post includes the approved comments in `content/_data/comments/{slug}.json` as well as the inbox log. The `conversation` filter takes the post's slug as a second argument and reads that file directly, not through the data cascade. Why: a namespaced `_data/comments/` directory would arrive as a global called `comments`, and `comments: true` in a post's front matter would shadow it on the pages that need it. The slug is on the context as `geekitySlug`. |
| `content/_trash/` is not published              | `ignores.add('content/_trash/**')`. Eleventy skips `_includes` and `_data` because they are configured directories, not because of the underscore. The config must name the trash.                                                                                                                                                                                                                                                                                                              |
| Dates are shown in the site's `timezone`        | A `date` filter with the CMS's four formats. `readable`, `html` and `year` give the calendar date in the site's zone at that instant. `iso` gives the instant in UTC. The filter reads the zone from `content/_data/site.json`, which the settings screen writes. A zone changed in the CMS changes the built pages too.                                                                                                                                                                        |
| A future `date` holds a post back               | An `addPreprocessor` returns `false` for the document. This is the one rule that cannot match the CMS exactly, because a build runs at one moment and has no clock. A build that runs before a scheduled post's date leaves the post out, and the next build after the date includes it. A site with scheduled posts needs a build on a schedule. The CMS publishes a scheduled post on its date with no build. `BUILD_SCHEDULED=1` builds them anyway.                                         |

The config also builds two collections that Eleventy does not have:

- `collections.categories` is the second taxonomy. It has one entry of
  `{ name, posts }` for each category in use, for paginating into archives at
  `/{{ site.categoryBase }}/{name}/`.
- `collections.menus` is the site's named menus, the `menus` object of
  `site.json` and nothing else. Each menu is an ordered list of
  `{ label, url }` entries, plus `rel` on a link that carries `rel` values.
  The collection is built once for the whole site, so a layout marks the
  current item itself by comparing `item.url` with `page.url`.

The files hold UTC instants, and the `timezone` setting decides how they
display. The config's `date` filter reads the zone from
`content/_data/site.json`, the file the settings screen writes. It renders with
`Intl`, so the config has no dependencies. If your site already uses
[Luxon](https://moment.github.io/luxon/), which Eleventy ships anyway, the same
filter is shorter:

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

Both versions match the CMS's own filter for every format, so a layout moved
from the CMS prints the same dates.

The config turns the template engine off for Markdown
(`markdownTemplateEngine: false`). The CMS renders Markdown with markdown-it
only. With Liquid or Nunjucks on, `{{ … }}` in a post would mean one thing on
the live site and another in the build.

You write the layouts. The directory data files name them. `posts.json` sets
`"layout": "post"` and `pages.json` sets `"layout": "page"`, so Eleventy looks
for `content/_includes/post.njk` and `content/_includes/page.njk`. The context
an Eleventy layout receives is the one this package's theme mirrors. You can
often move a layout from the CMS by removing only its `{% extends %}`.

The default theme's own layouts and partials also build. Copy them into
`content/_includes/` as `layouts/` and `partials/`. The config adds the theme's
other filters (`absoluteUrl`, `asset`, `host`, `fediverseHandle`) and the
`newestPosts(count)` function that a front page override uses to list posts. A
site theme's `front-page.njk` that calls `{% set posts = newestPosts(5) %}`
builds. The templates get only the context the config provides:

- `collections.menus`, not `menus`
- the `conversation` filter, not the key
- no comment form, search or listing pagination

Some things do not carry over:

- `/feed/`, `/feed/atom/` and `/feed/json/` are generated in code, not by a
  template. An Eleventy build needs its own.
- `/sitemap.xml` and `/robots.txt` are also generated in code, so an Eleventy
  build needs its own.
- A comment's own page at `/comment/{key}/` is not written, because a build has
  no server to accept a comment. A comment links to its `#comment-{key}` anchor
  on the post.
- The site's own reply posts are not threaded under the posts they answer.
- A document's backlinks are not listed.
- `[[wiki links]]` are not rendered. The build prints the brackets as written.
- The wiki index at `/{wikiBase}/` is generated in code, so an Eleventy build
  needs its own.

Reply threading and backlinks read the CMS's index of every document, which the config's
filters do not have. The config's header lists the same gaps.

## The compatibility test

```sh
pnpm --filter @geekity/cms test:11ty   # or, from the repository root, pnpm test:11ty
```

`test:11ty` builds `test/fixtures/` with Eleventy 3 and the example config.
Then it checks every document against what the CMS computed for the same file:

- The output path equals the permalink plus `index.html`.
- Drafts and the trash are absent.
- Uploads are copied byte for byte.

The fixtures cover a post whose permalink is not the default, a hand-authored
post and page with no permalink, an accented title, a draft and a trashed file.

`test:11ty` is a separate script from `pnpm test`. The unit suite stays fast
and does not need a build tool. `test:11ty` pulls in Eleventy, writes a
temporary directory and is slow. CI runs both. Neither `docs/` nor `test/` is
in the published tarball. Copy the example config from the repository.

The repository's demo site runs the same comparison over realistic content,
with the two layouts above in `apps/demo/content/_includes/`. `pnpm test:11ty`
from the root runs both.
