---
id: doc-2
title: Content Format (11ty-compatible Markdown)
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-02 13:23'
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

Post filenames carry a date prefix so they sort on disk. Pages do not. The CMS never depends on filename parsing for URLs; it always reads `permalink` from front matter.

## Front matter

Keys the CMS reads and writes. Eleventy semantics are preserved.

| Key | Required | Eleventy meaning | CMS use |
| --- | --- | --- | --- |
| `title` | yes | data | display title |
| `date` | posts | sets page date | publish date, ISO 8601 with offset |
| `permalink` | yes | output URL | canonical URL path; always written explicitly so 11ty and the CMS agree |
| `tags` | no | collections | taxonomy; `post` tag comes from `posts.json`, not from the file |
| `draft` | no | honoured by an 11ty preprocessor | `true` hides from public site and feeds |
| `description` | no | data | meta description and excerpt fallback |
| `layout` | no | template | not written per file; comes from directory data |
| `eleventyExcludeFromCollections` | no | hides from collections | mirrored for pages that should not list |

Extra keys, ignored by Eleventy, prefixed to avoid collisions:

| Key | Use |
| --- | --- |
| `updated` | last modified date, written on every admin save |
| `author` | user login; resolved to display name at render |
| `activitypub.id` | the ActivityStreams object id once federated, so Update/Delete reference the same object |
| `activitypub.published` | timestamp of first delivery |

Unknown keys are preserved on round trip. The writer emits YAML with a stable key order so diffs stay small.

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
