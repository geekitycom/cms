# Template context

The context mirrors what an Eleventy layout receives, so a layout ported from
an Eleventy build needs few edits. It is part of the package's semver contract.

Every template gets:

| Key           | What it holds                                                                                                                                                                                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site`        | `content/_data/site.json`, if the site has one, over the defaults `title` and `url`. Any key in the file is readable, so `site.tagline`, `site.author` and anything else a site adds are all available.                                                                                                                          |
| `menus`       | Every menu the site stores, by name, marked for this page: `menus.primary`, `menus.footer`, and any other name. See [Navigation](navigation.md).                                                                                                                                                                                 |
| `siteAuthor`  | Who the page is by, as a profile. **Absent** when nobody matches. See [Bylines and author archives](bylines.md).                                                                                                                                                                                                                 |
| `soloAuthor`  | The site author's profile, on every page of a site whose Site author setting names a user. **Absent** on a site with several authors. See [The bio](page-shell.md#the-bio).                                                                                                                                                      |
| `icons`       | The site's icons, as `{ rel, sizes, type, href }`. Empty until the site has an icon or an avatar to derive them from. See [The head](page-shell.md#the-head).                                                                                                                                                                    |
| `theme`       | The colours the theme declares, as `{ colorScheme, themeColor: { light, dark } }`, each absent when no theme declares it. See [The manifest](manifest.md).                                                                                                                                                                       |
| `shareImage`  | The picture a shared link shows, as `{ url, alt, size: { width, height }, card }`. `size` is absent when it is not known. **Absent** when there is no picture. See [The head](page-shell.md#the-head).                                                                                                                           |
| `llmsTxt`     | The path of `/llms.txt`, while the site serves it. **Absent** when the site has turned it off. The default theme links it from the front page only.                                                                                                                                                                              |
| `license`     | The page's license as `{ name, url }`: the page's `license` front matter, else the site's. **Undefined** with none. It replaces the raw front matter value on the context.                                                                                                                                                       |
| `siteLicense` | The site's own license as `{ name, url }`, whatever the page says. **Undefined** with none.                                                                                                                                                                                                                                      |
| `devMode`     | `true` while the site is in dev mode, from the config or from `geekity dev-mode on`, as `geekity dev-mode status` reports it. It is read on every render, so `geekity dev-mode off` changes it on the next request.                                                                                                              |
| `signedIn`    | `true` when the page is drawn for a reader signed in to the admin: a live session for a user who still exists. That page is sent `Cache-Control: private, no-store` with no validator, so no shared cache gives it to anybody else. `false` for everybody else, and in the editor's preview, which sets `editorPreview` instead. |

A document — one post, one page, or one entry of a listing — adds:

| Key                                         | What it holds                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `title`                                     | Display title.                                                                                                    |
| `date`                                      | Publish date, a JavaScript `Date` at the UTC instant the file holds. Absent when the document has none.           |
| `updated`                                   | Last modified date, a `Date`, when the front matter has one.                                                      |
| `tags`                                      | The document's tags, in file order.                                                                               |
| `categories`                                | The document's categories, in file order.                                                                         |
| `content`                                   | The Markdown body rendered to HTML. Print it with `\| safe`.                                                      |
| `summary`                                   | Its `description` as plain text, else an excerpt of the body, else empty. The line the feeds publish.             |
| `url`                                       | The document's URL path, the same value as `page.url`.                                                            |
| `page.url`                                  | The document's URL path. Always ends in `/`.                                                                      |
| `page.date`                                 | The same `Date` as `date`.                                                                                        |
| `page.fileSlug`                             | The permalink's last segment.                                                                                     |
| `page.inputPath`                            | The source file, relative to the content directory.                                                               |
| `type`                                      | `post` or `page`.                                                                                                 |
| `permalink`, `slug`, `draft`, `description` | Straight from the front matter.                                                                                   |
| `lang`                                      | The `lang` front matter as a canonical tag, such as `fr-CA`. Absent when it names none or no tag.                 |
| `enclosure`                                 | The post's recording, parsed, with `player` (`audio` or `video`) and `transcript.captions`. Absent with none.     |
| `photos`                                    | The post's photos, each `{ url, alt, html }`; `html` is the `img.u-photo`, responsive. Empty with none.           |
| `citations`                                 | What it reposts, likes or bookmarks, each `{ property, url, context }`; `context` as `replyContext`, when known.  |
| `read`                                      | A read post's `{ status, statusLabel, of, line }`; `of` is `{ name, author, uid, uidLabel, url }`.                |
| `rsvp`                                      | An RSVP's `{ value, label, line }`: `yes`, `no`, `maybe` or `interested`, its words, and its `p-rsvp` line.       |
| `event`                                     | An event's `{ start, end, location }`: `Date`s, and `{ kind: "place", name }` or `{ kind: "virtual", url }`.      |
| `syndicateTo`                               | On a post's page, the syndication targets it selects, each `{ id, name, url }`. Empty with none.                  |
| `syndication`                               | Its copies elsewhere, each `{ url, label }`: front matter `syndication`, and on its page the copies targets made. |
| `original`                                  | Where it was first published, `{ url, label }`: `canonical_href`, named by `canonical_name` or its host.          |
| `author`                                    | Who wrote it, as a profile rather than a string. See [Bylines and author archives](bylines.md).                   |
| `activityStreams`                           | The post's ActivityPub object id, absolute. Only on a rendered published post.                                    |
| `previous`                                  | The published post before this one by date, as `{ title, url }`. Absent on the oldest post.                       |
| `next`                                      | The published post after it. Absent on the newest post, and on a page.                                            |
| `backlinks`                                 | The site's listed posts and pages that link to it, newest first, each `{ title, url, date }`. Empty with none.    |
| `newestPosts`                               | A function, front page only: `newestPosts(5)` is the five newest published posts, as entries.                     |
| `postsPage`                                 | The page carrying the listing, as `{ title, url }`, on the front page only. Absent when the site names none.      |
| `archiveMonths`                             | Every published post as `{ month, posts }`, newest month first. Only on a page that says `archive: true`.         |
| `webmention`                                | Where a webmention about this page is sent. Only on a rendered document, and only while the site takes them.      |
| `noindex`                                   | `true` on an unlisted or unpublished page, which the base layout prints as a robots `noindex` meta. Else absent.  |
| `conversation`                              | The replies, likes and boosts under the post. Only when there are any. See [The conversation](conversation.md).   |
| everything else                             | Any front matter key the CMS does not model is on the context under its own name.                                 |

A listing — the home page, a tag archive, a category archive or an author
archive — adds:

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

How many posts a listing page holds comes from `postsPerPage` in
`content/_data/site.json`, and defaults to 10. How many entries a feed holds
comes from `feedSize` in the same file, and defaults to 20. The `<html lang>`
comes from `language`, and defaults to `en`. A document whose `lang` names
another language carries it on its own `<article>`, in an entry, a listing and
search results alike, through `partials/lang.njk`, and the dates inside that
article are written in it (see the `date` filter). The rssCloud and WebSub server the
feeds advertise comes from `notifyServer`, and is empty for none; the theme
writes nothing for it, because a cloud is advertised in the feed rather than on
the page.
