---
id: TASK-112
title: 'A profile link is checked like a menu line, and says it already carries rel=me'
status: To Do
assignee: []
created_date: '2026-09-20 17:06'
labels:
  - admin
  - web
dependencies: []
references:
  - packages/cms/src/admin/users.ts
  - packages/cms/src/web/navigation.ts
  - packages/cms/admin/pages/users/edit.njk
  - packages/cms/themes/default/partials/bio.njk
  - packages/cms/src/web/routes.ts
type: bug
ordinal: 137800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on shll.me. The maintainer typed a line they had learned from the Navigation screen into a user profile's Links box:

    Mastodon | https://shll.me/@a | me

`parseProfileLinks` (admin/users.ts:697) splits on the first `|` and validates nothing, so the link was stored with the href `https://shll.me/@a | me`. The page rendered it, the browser percent-encoded the space and the bar, the handle route took `/@a | me` and redirected, and the reader landed on `https://shll.me/author/a%20%7C%20me/`. Every layer did something defensible with nonsense it should have refused at the first one.

Three things to fix, in order of how much they matter:

**A profile link's URL is not checked.** The menu parser refuses a URL that is neither a path nor an absolute http(s) URL, and says which line is wrong. A profile link takes anything. The same rule and the same message belong here — the check already exists, so this is about using it rather than writing it.

**The two boxes disagree about what a line means.** A menu line is `Label | URL` with flags after further bars; a profile line is `Label | everything else`. Somebody who learns one is taught the wrong thing about the other, which is exactly what happened. Decide whether a profile link should take the flags too or whether the difference stays, and say on the screen which it is. Note that a profile link already renders `rel="me"` — `bio-links` in the packaged theme emits it — so a `me` flag would be either redundant or a way to turn it off, and today nothing on the screen says the links carry it at all.

**A handle route that redirects anything.** `/@a | me` redirected rather than answering 404, which is what turned a bad link into a confusing one. Check what the handle route does with a handle no user answers to, and make it say so.

The maintainer also asked whether rel=me matters at all: it is required by nothing in Geekity or ActivityPub, and exists for Mastodon's profile-field verification and IndieAuth. The Links hint should say what it is for, since somebody deciding what to type there has no other way to know.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A profile link whose URL is neither a path nor an absolute http(s) URL is refused, naming the line, the way a menu line is, proven by a test
- [ ] #2 The line typed on shll.me — a label, a URL and a trailing | me — is refused rather than stored, proven by a test
- [ ] #3 The Links box says that a profile link carries rel=me, and whether a flag is accepted there
- [ ] #4 The handle route answers 404 for a handle no user answers to rather than redirecting, proven by a test
- [ ] #5 A link already stored that would now be refused still renders and still round-trips through the form, so nobody's profile breaks on upgrade, proven by a test
<!-- AC:END -->
