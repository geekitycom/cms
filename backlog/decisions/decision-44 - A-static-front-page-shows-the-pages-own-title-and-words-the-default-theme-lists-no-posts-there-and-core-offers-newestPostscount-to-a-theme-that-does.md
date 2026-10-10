---
id: decision-44
title: >-
  A static front page shows the page's own title and words; the default theme
  lists no posts there and core offers newestPosts(count) to a theme that does
date: '2026-10-10 10:52'
status: accepted
---
## Context

decision-16 made the default theme the andrewshell.org design, including a
front-page.njk that printed the homepage's words, then Recent Posts chosen by
a fixed rule in core (`web/recent.ts`: this month's posts when there were at
least five, else the five newest; `RECENT_POSTS = 5`, not a setting), then a
fixed line of links (the posts page if any, then Search), then the bio.

The andrewshell.org migration showed this was opinion living in the package,
and it did not reproduce the WordPress site it came from. That site has no
posts page and `/essays/` is an `archive: true` page, so the line showed only
"Search →" where WordPress showed "See all essays → | See all notes → |
Search →".

On 2026-10-10 Andrew said a static homepage shows the page content and nothing
else, and dynamic content on the front page belongs in a site theme's override
of front-page.njk.

## Decision

This reverses decision-16 for the front page.

- The default theme's front-page.njk prints the page's title as
  `h2.section-title`, its rendered body, and the contact form when the page
  asks for one. Nothing else.
- Core removes the month-or-five rule (`recentPosts`, `RECENT_POSTS`,
  `startOfMonth`, `RecentPostsSource`, `ContentStore.listPostsSince`) and the
  `recentPosts` context key.
- The front page context carries `newestPosts(count)`. It returns the newest
  `count` published posts as listing entries, the shape
  `partials/post-list.njk` prints, from the query a listing uses, so drafts,
  future-dated, unlisted and trashed posts are left out. The theme chooses the
  count. The query runs only when a template calls it. A count that is not a
  whole number of at least 1 is an error.
- `postsPage` stays as neutral data.

A context function was chosen over a theme.json key or front matter because
the theme, not the content, picks the count, and themes already get all their
data as context keys.

## Consequences

- Breaking for any site theme that reads `recentPosts`, including
  andrewshell.org's override, which switches to `newestPosts(5)`.
- The public exports `recentPosts`, `RECENT_POSTS`, `startOfMonth` and
  `RecentPostsSource` are removed.
- The default stylesheet keeps `.section-title` and `.front-links` for
  overrides.
- The demo's `/` shows only its About page.
- The Eleventy example config does not provide `newestPosts`.
- Supersedes the front-page and `recentPosts` parts of decision-16. The rest
  of decision-16 stands.
