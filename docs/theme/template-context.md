# Template context

The context matches what an Eleventy layout receives. A layout ported from an
Eleventy build needs few edits. The context is part of the package's semver
contract.

Every template gets:

| Key           | What it holds                                                                                                                                                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site`        | `content/_data/site.json`, if the site has one, over the defaults `title` and `url`. Every key in the file is readable, for example `site.tagline`, `site.author` and any key a site adds.                                                                                                                                             |
| `menus`       | Every menu the site stores, by name, marked for this page: `menus.primary`, `menus.footer`, and any other name. See [Navigation](navigation.md).                                                                                                                                                                                       |
| `siteAuthor`  | Who the page is by, as a profile. **Absent** when no user matches. See [Bylines and author archives](bylines.md).                                                                                                                                                                                                                      |
| `soloAuthor`  | The site author's profile, on every page of a site whose Site author setting names a user. **Absent** on a site with several authors. See [The bio](page-shell.md#the-bio).                                                                                                                                                            |
| `icons`       | The site's icons, as `{ rel, sizes, type, href }`. Empty until the site has an icon or an avatar to derive them from. See [The head](page-shell.md#the-head).                                                                                                                                                                          |
| `headerIcon`  | The URL of the icon the header shows before the site title: the SVG upload when the icon is an SVG, else the derived 180 pixel PNG. **Absent** while the General setting is off, the site has no icon, or image optimization is off. See [The page shell](page-shell.md).                                                              |
| `theme`       | The colours the theme declares, as `{ colorScheme, themeColor: { light, dark } }`, each absent when no theme declares it. See [The manifest](manifest.md).                                                                                                                                                                             |
| `shareImage`  | The picture a shared link shows, as `{ url, alt, size: { width, height }, card }`. `size` is absent when it is not known. **Absent** when there is no picture. See [The head](page-shell.md#the-head).                                                                                                                                 |
| `llmsTxt`     | The path of `/llms.txt`, while the site serves it. **Absent** when the site has turned it off. The default theme links it from the front page only.                                                                                                                                                                                    |
| `capsuleUrl`  | This page's gemini:// URL, on a document, a listing, the search and a comment's page while the site serves Gemini. **Absent** while Gemini is off, and on a status page. See [Serving Gemini](../deploying.md#serving-gemini).                                                                                                         |
| `license`     | The page's license as `{ name, url }`: the page's `license` front matter, else the site's. **Undefined** with none. It replaces the raw front matter value on the context.                                                                                                                                                             |
| `siteLicense` | The site's own license as `{ name, url }`, whatever the page says. **Undefined** with none.                                                                                                                                                                                                                                            |
| `devMode`     | `true` while the site is in dev mode, from the config or from `geekity dev-mode on`, as `geekity dev-mode status` reports it. The CMS reads it on every render, so `geekity dev-mode off` changes it on the next request.                                                                                                              |
| `signedIn`    | `true` when the visitor is signed in to the admin: a live session for a user who still exists. The server sends that page with `Cache-Control: private, no-store` and no validator, so no shared cache serves it to another visitor. `false` for every other visitor, and in the editor's preview, which sets `editorPreview` instead. |
| `pluginTags`  | The tags the running plugins add, as `{ headEnd, bodyEnd }`, each a string of markup that prints unescaped, empty when no plugin adds a tag. See [Plugins](../plugins.md).                                                                                                                                                             |

A document, which is one post, one page, one wiki page or one entry of a
listing, adds:

| Key                                         | What it holds                                                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                                     | Display title. Empty for an untitled post or page.                                                                                                                                           |
| `label`                                     | What a link to it says: its title, else its first words or `Untitled` ([Titles](../content.md#titles)).                                                                                      |
| `date`                                      | Publish date, a JavaScript `Date` at the UTC instant the file holds. Absent when the document has none.                                                                                      |
| `updated`                                   | Last modified date, a `Date`, when the front matter has one.                                                                                                                                 |
| `tags`                                      | The document's tags, in file order.                                                                                                                                                          |
| `categories`                                | The document's categories, in file order.                                                                                                                                                    |
| `content`                                   | The Markdown body rendered to HTML. Print it with `\| safe`.                                                                                                                                 |
| `summary`                                   | Its `description` as plain text, else an excerpt of the body, else empty. The line the feeds publish.                                                                                        |
| `url`                                       | The document's URL path, the same value as `page.url`.                                                                                                                                       |
| `page.url`                                  | The document's URL path. Always ends in `/`.                                                                                                                                                 |
| `page.date`                                 | The same `Date` as `date`.                                                                                                                                                                   |
| `page.fileSlug`                             | The permalink's last segment.                                                                                                                                                                |
| `page.inputPath`                            | The source file, relative to the content directory.                                                                                                                                          |
| `type`                                      | `post`, `page` or `wiki`.                                                                                                                                                                    |
| `permalink`, `slug`, `draft`, `description` | Straight from the front matter.                                                                                                                                                              |
| `lang`                                      | The `lang` front matter as a canonical tag, such as `fr-CA`. Absent when it names none or no tag.                                                                                            |
| `enclosure`                                 | The post's recording, parsed, with `player` (`audio` or `video`) and `transcript.captions`. Absent with none.                                                                                |
| `photos`                                    | The post's photos, each `{ url, alt, html }`. `html` is the `img.u-photo`, responsive. Empty with none.                                                                                      |
| `citations`                                 | What it reposts, likes or bookmarks, each `{ property, url, context }`. `context` has the shape of `replyContext`, when known.                                                               |
| `rsvp`                                      | An RSVP's `{ value, label, line }`: `yes`, `no`, `maybe` or `interested`, its words, and its `p-rsvp` line.                                                                                  |
| `review`                                    | A review's `{ item, kindLabel, rating, best, html }`: the item as front matter has it, its kind's words, the rating 1 to 5 when it has one, `best` (5), and `html`, the `p-item` and rating. |
| `event`                                     | An event's `{ start, end, location }`: `Date`s, and `{ kind: "place", name }` or `{ kind: "virtual", url }`.                                                                                 |
| `syndicateTo`                               | On a post's page, the syndication targets it selects, each `{ id, name, url }`. Empty with none.                                                                                             |
| `syndication`                               | Its copies elsewhere, each `{ url, label }`: front matter `syndication`, and on its page the copies targets made.                                                                            |
| `original`                                  | Where it was first published, `{ url, label }`: `canonical_href`, named by `canonical_name` or its host.                                                                                     |
| `author`                                    | Who wrote it, as a profile, not a string. See [Bylines and author archives](bylines.md).                                                                                                     |
| `activityStreams`                           | The post's ActivityPub object id, absolute. Only on a rendered published post.                                                                                                               |
| `previous`                                  | The published post before this one by date, as `{ title, url }`. Absent on the oldest post.                                                                                                  |
| `next`                                      | The published post after it. Absent on the newest post, and on a page.                                                                                                                       |
| `backlinks`                                 | The site's listed posts, pages and wiki pages that link to it, newest first, each `{ title, url, date }`. Empty with none.                                                                   |
| `newestPosts`                               | A function, front page only: `newestPosts(5)` is the five newest published posts, as entries.                                                                                                |
| `postsPage`                                 | The page carrying the listing, as `{ title, url }`, on the front page only. Absent when the site names none.                                                                                 |
| `archiveMonths`                             | Every published post as `{ month, posts }`, newest month first. Only on a page that says `archive: true`.                                                                                    |
| `webmention`                                | Where a webmention about this page is sent. Only on a rendered document, and only while the site takes them.                                                                                 |
| `noindex`                                   | `true` on an unlisted or unpublished page, which the base layout prints as a robots `noindex` meta. Else absent.                                                                             |
| `conversation`                              | The replies, likes and boosts under the post. Only when there are any. See [The conversation](conversation.md).                                                                              |
| `pageChallenge`                             | The challenge a form on the page draws: a stranger's comment form's, else a shown contact form's. Absent with none. See [The form challenge](comment-form.md#the-form-challenge).            |
| everything else                             | Any front matter key the CMS does not model is on the context under its own name.                                                                                                            |

A listing, which is the home page, a tag archive, a category archive or an
author archive, adds:

| Key                                        | What it holds                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `title`                                    | The site title on the home page, the term on a taxonomy archive.                  |
| `posts`                                    | The documents on this page of the listing, newest first, each in the shape above. |
| `pagination.items`                         | The same array, under the name Eleventy gives it.                                 |
| `pagination.pageNumber`                    | Zero-based index of this page, as in Eleventy.                                    |
| `pagination.totalPages`, `.total`, `.size` | How many pages, how many documents, how many per page.                            |
| `pagination.href.first/last/next/previous` | Pager URLs. `next` and `previous` are `null` at the ends.                         |
| `pagination.pages`                         | Every page's URL, in order.                                                       |
| `tag`                                      | The tag, on a tag archive only.                                                   |
| `category`                                 | The category, on a category archive only.                                         |
| `author`                                   | The person, on an author archive only. Same shape as a post's `author`.           |

The wiki index adds `wikiGroups`, and the 404 at a wiki page's URL adds
`createWikiPage` for a signed-in user. See
[A wiki page and the wiki index](page-shell.md#a-wiki-page-and-the-wiki-index).

These keys in `content/_data/site.json` set values that templates use:

| Key            | Sets                                                     | Default         |
| -------------- | -------------------------------------------------------- | --------------- |
| `postsPerPage` | How many posts a listing page holds.                     | `10`            |
| `feedSize`     | How many entries a feed holds.                           | `20`            |
| `language`     | The `<html lang>`.                                       | `en`            |
| `notifyServer` | The rssCloud and WebSub server that the feeds advertise. | empty, for none |

A document whose `lang` names another language carries it on its own
`<article>`, through `partials/lang.njk`. This applies in an entry, a listing
and search results. The dates inside that article are in that language (see
the `date` filter). The theme writes nothing for `notifyServer`, because the
feed advertises a cloud, not the page.
