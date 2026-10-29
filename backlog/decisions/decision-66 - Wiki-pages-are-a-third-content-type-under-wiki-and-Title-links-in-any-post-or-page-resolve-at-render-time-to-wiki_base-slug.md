---
id: decision-66
title: >-
  Wiki pages are a third content type under wiki/, and [[Title]] links in any
  post or page resolve at render time to /<wiki_base>/<slug>/
date: '2026-10-29T18:10:00Z'
status: accepted
---
## Context

The operator wants to keep a set of linked notes on their site and write links between them the way a wiki does: `[[Some page]]` in the body, with no URL to look up. Writing `[[Some page]]` anywhere in a post, page or wiki page should become a link to `/wiki/some-page/`, and `/wiki/` should list every wiki page.

There are two document types today, posts under `posts/` and pages under `pages/`. Each is described by a `DocumentKind` (`src/content/document-kind.ts`), and the admin mounts both with `mountDocumentScreens`. A page's URL comes from the `permalink` stored in its front matter. Body HTML is rendered by markdown-it when a file is indexed and is stored. The `.md` and `.gmi` representations are rewritten from the Markdown body by `rewriteMarkdownLinks`. The `fediverseHandles` inline rule is the existing example of syntax resolved at render time. Settings > Permalinks holds `tag_base` and `category_base`.

The operator chose between three ways to mark a wiki page: any page whose permalink is under the base, a front-matter flag on a page, or a content type of its own. They chose a content type of its own.

## Decision

**A third content type.** Wiki pages are documents of type `wiki`, stored as `wiki/<slug>.md` in the content directory. A `WIKI_KIND` describes them. They are undated, have no tags or categories, are not federated, are not in feeds or the home and archive listings, and offer no contact form, no reply and no location. They have drafts and trash like pages. They are not scheduled.

**The URL comes from the base and the file name.** A wiki page's permalink is `/<wiki_base>/<slug>/`, where the slug is the file name. It is derived when the file is read and is not stored in front matter, so changing the base moves every wiki page at once. A wiki page takes no custom permalink. A post or page permalink under `/<wiki_base>/` is refused when it is saved, so the wiki owns that path.

**The base is a permalink setting.** `wiki_base` sits on Settings > Permalinks beside `tag_base` and `category_base`, with `wiki` as the default. It follows the same rules as those two: the same pattern, not a reserved top-level path, and different from both of them. When the base changes, the old paths answer with a 301 to the new ones, as a renamed taxonomy term does.

**Link syntax.** `[[Target]]`, `[[Target|text]]`, `[[Target#Heading]]` and `[[Target#Heading|text]]`. The target's slug is `slugify(Target)` and the anchor is the heading slug that `headingAnchors` gives. The link text is `text` if given and `Target` if not. A target that slugifies to nothing stays literal text. Code spans, code blocks and an escaped `\[[` are left alone. The syntax works in posts, pages and wiki pages. It does not work in comments.

**Resolved at render time, and the source keeps `[[ ]]`.** An inline markdown-it rule writes `<a class="wiki-link" href="/<wiki_base>/<slug>/">`. The same rule is added to the link parser in `markdown-links.ts`, so the `.md` representation gets an ordinary `[text](url)` link and the Gemini one gets a `=>` line. The stored file is never rewritten. Feeds, ActivityPub, excerpts and backlinks read the stored HTML and so get the real link without changes of their own.

**Links do not depend on whether the target exists.** A link to a missing wiki page is still a link, so stored HTML depends only on the body and the base, never on which other pages exist. A missing target is a 404 to visitors. A signed-in user who can write gets a "Create" button on that 404, which opens the wiki editor with the slug filled in and a title made from the slug.

**The index.** `/<wiki_base>/` lists every published wiki page from A to Z by title, grouped by first letter, on one page with no pagination, in HTML, `.md`, `.gmi` and `.json`. Themes draw it with a `wiki-index` layout, and draw each wiki page with a `wiki` layout that shows when it was last updated and which pages link to it. When there are no published wiki pages the index is a 404, as an empty tag archive is.

**The editor.** All three editors highlight `[[...]]`, match its brackets, and underline a target with no wiki page behind it as you type. A trashed page counts as missing and a draft counts as present. The editor slugifies with the same function the server uses.

## Consequences

- A change of `wiki_base` makes the stored HTML of every document with a wiki link out of date, so the change re-renders those documents.
- `DocumentType` and the plugin-facing `'post' | 'page'` type gain `'wiki'`. A plugin that switches on the type exhaustively needs a case for it.
- Site search, the sitemap, `/llms.txt`, export, autosave, preview and the MCP authoring tools have to accept the new type. Micropub does not, because it has no way to name one.
- A theme that does not provide the `wiki` and `wiki-index` layouts falls back to the default theme's, as for any missing layout.
- No "wanted pages" list is kept, because only the slug of a missing target is known. If one is wanted later, the render has to record the link text of each target, as `handlesIn` records handles.
