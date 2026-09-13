---
id: doc-2
title: Content Format (11ty-compatible Markdown)
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-13 03:13'
---
# Content Format (11ty-compatible Markdown)

Content files must build unchanged under Eleventy 3.x. We use only front matter keys Eleventy already understands, plus a small set of extra keys Eleventy ignores.

## Directory layout

```
content/
  posts/
    posts.json                 directory data: {"layout":"post","tags":["post"]}
    2026-09-02-hello-world.md
  pages/
    pages.json                 directory data: {"layout":"page"}
    about.md
  uploads/                     images and files, passthrough copy in 11ty
    2026/09/photo.jpg
  _data/
    site.json                  title, tagline, url, author (mirrored from settings)
```

`site.json` also carries what the site chooses on the Reading settings page,
including WordPress's own question of what the front page shows: `homepage` is
the slug of the page served at `/` and `postsPage` the slug of the page whose
own URL carries the post listing. Both are absent when the site shows its
latest posts at `/`, which is the default; `postsPage` needs a `homepage`
beside it, and is ignored without one. They are slugs rather than URLs because
the setting follows the page rather than the permalink it happens to have, and
a slug naming no published page is a site back on its latest posts. An Eleventy
build reads the same two keys: `docs/eleventy.config.example.js` puts the
homepage at `/` and flags the posts page on the context as `isPostsPage`.

Post filenames carry a date prefix so they sort on disk. Pages do not. The CMS never depends on filename parsing for URLs; it always reads `permalink` from front matter.

## Front matter

Keys the CMS reads and writes. Eleventy semantics are preserved.

| Key | Required | Eleventy meaning | CMS use |
| --- | --- | --- | --- |
| `title` | yes | data | display title |
| `date` | posts | sets page date | publish date, a UTC ISO 8601 instant ending in `Z` |
| `permalink` | yes | output URL | canonical URL path; always written explicitly so 11ty and the CMS agree |
| `tags` | no | collections | taxonomy; `post` tag comes from `posts.json`, not from the file |
| `categories` | no | data | the second taxonomy, archived at `/category/{name}/`; Eleventy reads it as an ordinary data key |
| `draft` | no | honoured by an 11ty preprocessor | `true` hides from public site and feeds |
| `description` | no | data | meta description and excerpt fallback |
| `layout` | no | template | not written per file; comes from directory data |
| `eleventyExcludeFromCollections` | no | hides from collections | mirrored for pages that should not list |
| `navigation` | no | data | `true` puts a page in the site menu, after the items the settings screen names |
| `contact` | no | data | `true` renders a contact form under a page: name, email, subject, message. Messages land under `data/contact/` and on `/admin/messages`, and are emailed to the site's `contactEmail`. The destination address is never in the page |

Extra keys, ignored by Eleventy, prefixed to avoid collisions:

| Key | Use |
| --- | --- |
| `updated` | last modified date, a UTC instant, written on every admin save |
| `author` | user login; resolved to display name at render |
| `activitypub.published` | timestamp of first delivery, a UTC instant. The only key the CMS writes here: it records that the post has been announced and when, which is what decides `Create` against `Update` |
| `activitypub.id` | never written by the CMS. A post's ActivityStreams object id is its permalink (decision-13); this key is read, not minted, so a post migrated from elsewhere keeps the id its followers already hold — `https://example.com/?p=813` — and every `Update` and `Delete` names it |
| `navigationOrder` | where a page in the menu sorts; the lower numbers first, and a page with none after every page with one |

Unknown keys are preserved on round trip. The writer emits YAML with a stable key order so diffs stay small.

## Dates

Every date the CMS writes — `date`, `updated` and `activitypub.published` — is a UTC ISO 8601 instant ending in `Z`. The instant is the truth; the site's `timezone` setting is the lens it is read through (decision-11).

- The editor shows a stored instant as wall-clock time in the site's zone, names the zone under the field, and reads offset-less input as that zone. `2026-09-04 09:00` in a site set to `America/Chicago` is written as `2026-09-04T14:00:00Z`.
- The theme's `date` filter renders `readable`, `html` and `year` in the site's zone; `iso` stays the instant. Changing the setting changes what every page shows without a file changing.
- A new post's filename day and the `/{yyyy}/{mm}/` of its default permalink come from the calendar day the site's zone was on at that instant, taken once when the post is saved. The permalink is then written explicitly into the file, so changing the setting later never moves a URL.

A file written by hand is still read as it is. A `date` carrying an offset, or one YAML parses into a timestamp of its own, names an instant and is sorted, scheduled and rendered by it; the CMS rewrites it as UTC the next time it saves that file, never on a mere scan. A hand-written file with no `permalink` resolves to the URL Eleventy gives it, which is cut from the date exactly as the file spells it.

Feeds, the sitemap and the ActivityStreams objects emit instants and are not affected by the setting.

## Permalink rules

- Posts default to `/{yyyy}/{mm}/{slug}/`. Pages default to `/{slug}/`. Both are just defaults the admin form fills in; the stored value is what counts.
- Slug is derived from the title on creation, lowercased, ASCII, hyphenated, and unique within the index. Editing the slug later rewrites `permalink` but does not rename the file.
- Trailing slash is canonical. Requests without it redirect.

## Drafts and status

`draft: true` is the only status flag. There is no scheduled publishing in phase one; a future date with `draft: false` is simply published with that date, which matches 11ty. Trashing a post moves the file to `content/_trash/` (an underscore directory that Eleventy ignores) so it can be restored.

## Markdown dialect

markdown-it with the same options 11ty uses by default (`html: true`), plus:

- footnotes
- heading anchors
- fenced code with language class only (no server-side highlighting)

Anything that must survive an Eleventy build is checked by a test that runs Eleventy against the fixtures directory.
