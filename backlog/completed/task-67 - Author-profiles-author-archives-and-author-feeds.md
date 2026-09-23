---
id: TASK-67
title: 'Author profiles, author archives and author feeds'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 13:51'
updated_date: '2026-09-13 04:03'
labels:
  - web
  - admin
  - content
milestone: m-11
dependencies: []
references:
  - packages/cms/src/admin/accounts.ts
  - packages/cms/src/admin/users.ts
  - packages/cms/src/web/routes.ts
  - packages/cms/src/web/feeds.ts
  - packages/cms/src/admin/documents.ts
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
  - backlog/docs/doc-2 - Content-Format-11ty-compatible-Markdown.md
type: feature
ordinal: 99100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-14 makes each user an actor at their author URL, so the URL has to be a page first. Give a user a profile: a display name, a short bio, an avatar and a list of links, edited on the users screen (an admin edits anyone's, a user edits their own) and stored in data/users.json beside the account. Make the author front matter name a user: a post says who wrote it by username, the editor sets it to the signed-in user for a new post and offers the list for an existing one, and an existing file whose author is a display name matching exactly one user's name reads as that user until it is next saved. Serve /author/{username}/ as an archive of that user's published posts, paged like the home page, and /author/{username}/feed/, /feed/atom/ and /feed/json/ as that user's feeds, shaped by the feed item from TASK-63 and linked from the archive. The templates get an author object with the profile so a theme can render a byline and a link; the default theme does. author joins the reserved top-level paths, and a username that is not a URL-safe slug is refused at creation. Nothing federates yet; TASK-68 puts the actor on this URL.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A user has a display name, bio, avatar and links on the users screen, stored in data/users.json, editable by that user and by an admin; a user with no profile still has an archive under their username
- [x] #2 A post's author is a username: the editor sets and offers it, the template context exposes the profile as author, and a file whose author is a display name matching exactly one user reads as that user
- [x] #3 /author/{username}/ lists that user's published posts newest first with pagination and a 404 for an unknown user; /author/{username}/feed/, feed/atom/ and feed/json/ serve the same posts in the three formats with the archive advertising them
- [x] #4 author is a reserved top-level path; a username that would not survive as a URL segment is refused when the user is created
- [x] #5 The default theme shows a byline linking to the archive on a post and a heading with the profile on the archive; the demo's posts and its second user, if any, render
- [x] #6 doc-2 (author front matter), doc-3 (author feeds), doc-5 (users screen) and the theme README describe it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Seams under test: accounts.ts profile read/write; new web/authors.ts (URL shape, path parsing, name-to-user resolution); ContentStore.listByAuthor/countByAuthor; the public site through cms.app.request (archive, pagination, 404, three feeds, slash redirects); the users screen and the editor through the admin harness; credentials.usernameProblem.

1. Profile on the user record. Add a UserProfile ({ displayName, bio, avatar, links: [{label, href}] }) under a 'profile' key on User in admin/accounts.ts, parsed as tolerantly as the notification maps, plus setUserProfile(). A user with no profile has no key.
2. Username as a URL segment. usernameProblem refuses a name that would not survive as a URL segment ('.' and '..'), so an account that cannot have an archive cannot be created.
3. Reserved paths. 'author' and 'inbox' join RESERVED_TOP_LEVEL_PATHS in web/taxonomy.ts, and the pinning test in taxonomy.test.ts covers the new author base.
4. New module web/authors.ts: AUTHOR_BASE, authorHref(username, index), authorFeedHref(username, format), parseAuthorPath(pathname), and the resolution decision-14 asks for — a stored author string reads as a user when it equals a username, else when it is the display name of exactly one user — with the inverse (authorNames) for the query, and authorContext() for what a theme sees.
5. Index. ContentStore gains listByAuthor(names, options) and countByAuthor(names) over published posts, an IN over the author column, so the archive and its feeds are one query each.
6. Routes. mountPublicSite registers /author/:username/, /author/:username/page/:n/ and the three feeds; the slashless forms redirect through the existing canonicalTarget; an unknown user 404s through the theme. The listing helpers take an author beside the term rather than a second copy of the listing code.
7. Theme context. createRenderer takes an author resolver injected the way the conversation and the forms are; documentContext exposes 'author' as the profile object rather than the raw string (breaking for a theme that printed it); Listing carries the author for the archive heading.
8. Default theme. layouts/author.njk with the profile and the feed links, a byline on post.njk and in post-list.njk linking to the archive, and the README describing both.
9. Editor. The author field is a select of the users, defaulted to the signed-in user for a new document and to the stored author for an existing one; a submitted name that is no user keeps what the file said.
10. Users screen. A profile form per row beside the email one, posting to /admin/users/profile.
11. Docs. doc-2 (author names a user), doc-3 (the author archive and its feeds), doc-5 (the users screen and the editor field), the theme README and the package README route table.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Profiles. `User` gains an optional `profile` ({ displayName, bio, avatar, links }) in data/users.json, written by setUserProfile and read through the same cleanProfile a save goes through, so a hand-edited file and a saved one read identically. A field left empty is not stored and a profile with nothing in it leaves no key.

Resolution. New module packages/cms/src/web/authors.ts owns the whole subject: AUTHOR_BASE, INBOX_BASE, authorHref, authorFeedHref, parseAuthorPath, userForAuthor (username exactly, else the display name exactly one user answers to), authorNames (the inverse, computed by asking userForAuthor rather than restating it) and the AuthorContext a theme sees. taxonomy.ts reserves 'author' and 'inbox' as literals because authors.ts reads PAGE_SEGMENT from it; taxonomy.test.ts pins the two lists together.

Index. ContentStore.listByAuthor(names, options) and countByAuthor(names) — an IN over the author column with one bound parameter per name, published posts only.

Routes. routes.ts now carries a ListingSubject ({ term?, author? }) instead of a bare term, so the home listing, a taxonomy archive and an author archive share one pager, one negotiator, one validator and one ETag. parseListingPath takes an AuthorLookup, read lazily once per request off data/users.json; a username nobody has is not a listing at all, which is what turns it into one 404. An author archive answers even with nothing on it, unlike a tag archive: decision-14 makes the URL an actor id, and an id that 404'd until its owner published would be an account that came into being with a post. Everything else — the slash redirect, page/1/ collapsing, /feed/rss/, ?feed=atom, the .json escape hatch — falls out of the existing machinery.

Theme. documentContext takes the resolved author, so the context's `author` is an object (name, url, username, bio, avatar, links) rather than the front matter's string: BREAKING for a theme that printed it. createRenderer takes a `users` resolver injected the way pages and conversation are, read once per render. New layouts/author.njk and partials/byline.njk; post.njk prints the byline; the demo's own post.njk override was updated to the new shape and is the worked example.

Editor. The Author field is a select of the site's users, defaulted to the signed-in user for a new document and to the user the file's name resolves to for an existing one, with an extra marked option for a file naming somebody with no account so Update cannot silently reattribute a post. A save writes the username, which is doc-2's 'until it is next saved'.

Deliberately out of scope: the sitemap does not list author archives — doc-3's sitemap section is unchanged and no acceptance criterion asks for it.

Validation: pnpm build, pnpm test (1549 package + 15 demo, all passing), pnpm test:11ty (16 + 5), pnpm typecheck, pnpm lint and pnpm format:check all pass.

Evidence per criterion. #1 accounts.test.ts 'a user with a profile' and users.test.ts 'a user profile' (a row edited from another user's session, cleared when emptied, and a hand-written file read tolerantly), plus author-archive.test.ts 'gives a user with no profile an archive under their username'. #2 editor.test.ts 'who a post says wrote it' (the select, the login written, a stranger changing nothing, a display name offered as the user it reads as), authors.test.ts over the resolution rules, and author-archive.test.ts's byline cases. #3 author-archive.test.ts over HTTP: the listing, pagination, the 404 for an unknown username, the three feeds with their content types and the JSON feed's title, the archive's three rel=alternate links, the slash and page/1/ redirects and WordPress's older spellings. #4 taxonomy.test.ts pins the reserved list against AUTHOR_BASE and INBOX_BASE and refuses each reserved word as a base; author-archive.test.ts proves a page permalinked at /author/ada/ does not take the archive's URL; users.test.ts refuses '..' at /admin/users/new and credentials.test.ts covers the rule. #5 author-archive.test.ts over the packaged theme and apps/demo/test/site.test.ts over the demo's own content, which creates a user answering to the demo posts' 'Andrew Shell' and checks the archive, its pagination, its feed and the byline link.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gave every user a public face and a URL. A profile — display name, bio, avatar and links — lives under `profile` on the user in data/users.json and is edited per row on /admin/users; doc-2's `author` now names a user, written as a username by an Author select in the editor and read generously for files written before decision-14, where a display name exactly one user answers to reads as that user. /author/{username}/ serves that person's published posts, paginated, headed by their profile, with their three feeds as children at /author/{username}/feed/, feed/atom/ and feed/json/; `author` and `inbox` are reserved top-level paths and a username that would not survive as a URL segment is refused at creation. The template context's `author` is the profile object rather than the front matter's string — breaking for a theme that printed it — and the default theme prints a byline linking to the archive and ships layouts/author.njk and partials/byline.njk. New module web/authors.ts owns the URL shape and the name-to-user rule; routes.ts now carries a listing subject so the home, taxonomy and author archives share one pager and one validator; ContentStore gained listByAuthor/countByAuthor. doc-2, doc-3, doc-5, the theme README and the package README route table describe it. Verified with pnpm build, test (1549 package and 15 demo), test:11ty, typecheck, lint and format:check, all passing; the behaviour itself is proven over HTTP in web/author-archive.test.ts and apps/demo/test/site.test.ts.
<!-- SECTION:FINAL_SUMMARY:END -->
