---
id: TASK-103
title: 'A signed-in commenter comments as themselves, with the form to match'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 11:52'
updated_date: '2026-09-20 13:29'
labels:
  - web
  - comments
milestone: m-16
dependencies: []
references:
  - packages/cms/themes/default/partials/comment-form.njk
  - packages/cms/src/comments/submission.ts
  - packages/cms/src/admin/session.ts
  - packages/cms/src/web/conversation.ts
  - packages/cms/src/comments/records.ts
type: feature
ordinal: 128800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The comment form asks everybody for a name, an email address and a website, because it assumes a stranger. Somebody signed in to the admin of their own site has already told it all three, and typing them again is both a chore and a way to end up with two spellings of the same person under one post.

When the request carries a valid admin session, draw the short form: the comment box, the reply-to line, and one sentence saying who it will be posted as, with a link to their profile. No name, email or website box, and no honeypot — the honeypot and the loaded-at timestamp are there to catch a robot filling a public form, and a session is better evidence than either.

The comment is then attributed from the account rather than from what was typed: the display name, or the username where there is no display name; the author archive as the website; the account's email, which is never shown, exactly as a stranger's is never shown.

Three things this has to get right, none of which are the obvious part:

**Moderation.** Geekity has one role, so anybody who can sign in can already publish a post and approve any comment. A comment from them waiting in a queue for them to approve is theatre. It should be approved on arrival and skip the spam check, and the task should say so where somebody later wonders why the Akismet call is not made.

**Cross-site request forgery.** The public comment form has no CSRF token today and does not need one: it acts on nobody's behalf. The moment it acts on a session, a page on another site can make a signed-in person post a comment under their own name without knowing it. The signed-in form needs the token the admin forms already use, checked the way `guard` checks it.

**Caching.** A post page is the same for everybody today. Once it says 'Commenting as ada' it is not, and a reverse proxy in front — which the Docker deployment documents — could hand one person's name to the next reader. The personalized response must say it is private, and the public one must stay cacheable.

The theme README documents the shape the comment form is handed, so whatever the signed-in form needs goes in there too: a theme that replaces `partials/comment-form.njk` has to be able to draw both.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With a valid session, the form asks only for the comment, names who it posts as, and carries no name, email, website or honeypot field, proven by a test
- [x] #2 The comment stored carries the account's display name, its author archive as the site, and its email, proven by a test
- [x] #3 A comment from a signed-in user is approved on arrival and no spam check is made for it, proven by a test
- [x] #4 The signed-in form carries a CSRF token, and a submission without a matching one is refused, proven by a test
- [x] #5 A page carrying the signed-in form is not cacheable by a shared cache, and the same page for a stranger is unchanged, proven by a test for each
- [x] #6 A stranger's form is exactly as it is today, honeypot and all, proven by the existing tests passing unedited
- [x] #7 An expired or forged session cookie falls back to the stranger's form rather than being trusted, proven by a test
- [x] #8 The theme README documents what the form is handed when somebody is signed in
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. **The session has to reach a public page at all.** `setSessionCookie` scopes the cookie to `Path=/admin`, so a browser never sends it to a post's permalink and none of this could work outside a test. Widen it to `Path=/` (and the matching `clearSessionCookie`), and lean on `SameSite=Lax` plus the CSRF token for what the path was buying. Update the one existing assertion in `admin/routes.test.ts` that pins the path.
2. **Who is signed in, read from a public request.** New `comments/viewer.ts`: `signedInCommenter(c)` reads `sessionIdFrom(c)`, asks the admin store (which prunes an expired session), refuses an anonymous pre-login session, and resolves the user out of `users.json`. It answers a `CommentViewer` — display name or username, author archive, account email, and the session's CSRF token — or `undefined`. Anything forged, expired or naming a user who has gone falls out as `undefined`, which is the stranger's form.
3. **The form the theme is handed.** `CommentFormContext` gains `signedInAs: { name, url }` and `csrfToken`; `COMMENT_FIELDS` gains `csrf`. A new pure `signedInCommentForm(form, viewer)` turns a stranger's form into a signed-in one, so `commentForm`/`refilledCommentForm` keep the signatures the package publishes. The account email never goes on the context.
4. **Threading the viewer to the render.** `Renderer.renderDocument`/`renderFrontPage` take an optional third argument, the viewer, and the `commentForm` callback `createRenderer` is given takes it as a second argument; `createCms` passes it to `commentFormFor({ ..., viewer })`. The public document route reads the viewer once per request and hands it over.
5. **The packaged partial.** One `{% if commentForm.signedInAs %}` branch: the CSRF hidden field and a `p.comment-signed-in` saying who it posts as, with a link to their archive; the `{% else %}` keeps the loaded-at hidden field, the honeypot and the name, email and website boxes exactly as they are. The comment box, the notify box and the button are shared.
6. **CSRF.** The POST handler reads the viewer and, when there is one, requires `csrfTokenMatches(viewer.csrfToken, body[csrf])`, answering the 403 and the words `guard` answers. A stranger's submission is unaffected.
7. **Attribution and moderation.** `submitComment` gains `author`: when it is set the honeypot and the form-age checks are skipped (a session is better evidence), only the comment body is validated, the stored author is the account's name, archive and email, and the intake is called with `origin: 'moderator'` — which is already the branch that approves on arrival and never asks the checker. `CommentOrigin`'s doc comment says so, so nobody later wonders why Akismet is not called. The per-address rate limit stays.
8. **Caching.** `representationResponse` gains `private`: a private response gets `cache-control: private, no-store` and no validator, so a shared cache cannot hold it and a browser cannot revalidate one reader's page into another's. The document route sets it only when the page was drawn for a viewer; a stranger's page keeps `vary: Accept`, its ETag and `cache-control: no-cache` untouched. The refused-submission page does the same.
9. **Docs.** The theme README's "The comment form" section documents `signedInAs`, `csrfToken` and `fields.csrf`, and says a replacement partial must draw both forms.
10. **Tests**, one per criterion, in a new `comments/signed-in.test.ts` driven over HTTP through `createCms`: the short form, the stored attribution, approved-on-arrival with a checker that would have been asked, a submission with a wrong and a missing token, the cache headers signed in and signed out, and a forged and an expired cookie. The existing comment tests stay unedited.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

A public request that carries a valid admin session is now a request the site knows the reader of. `comments/viewer.ts` is the one place outside `/admin` that turns a session cookie into a person: it answers a `CommentViewer` — display name or username, author archive, account email, session CSRF token — or `undefined`, which is the stranger's form. The public document route reads it once per request and hands it to the renderer, which hands it to the `commentForm` callback; the comment endpoint reads it again for itself.

## The one thing the task did not say, which it could not work without

`setSessionCookie` scoped the session cookie to `Path=/admin`. A browser never sends such a cookie to a post's permalink, so the short form, the token and the cache directive would all have been dead code outside a test harness (the test `browser()` sends the cookie at every path). The cookie is now `Path=/`, with `clearSessionCookie` matching. What the narrow path was buying — keeping the cookie off cross-site POSTs — is still bought by `SameSite=Lax`, and now twice over by the CSRF token on the one public form that acts on a session. What it costs is that a public response may be drawn for a named reader, which is exactly what criterion 5 is about. `admin/routes.test.ts` had the one assertion that pinned the old path; it now pins `Path=/` and says why.

## The three sharp edges

**Cross-site request forgery.** `COMMENT_FIELDS.csrf` is `CSRF_FIELD`, the same name every admin form uses, and the signed-in branch of the partial renders it as a hidden field. The endpoint reads the viewer before it touches the store and, when there is one, requires `csrfTokenMatches(viewer.csrfToken, form.csrf)` — the same constant-time comparison the admin `guard` makes, answering the same 403 and the same words. A stranger's submission carries no token and is asked for none: that form acts on nobody's behalf.

**Caching.** `representationResponse` gained `private`. A private response gets `Cache-Control: private, no-store` and **no** validator and skips the 304 path, because a browser revalidating its own copy would otherwise be told a page drawn while signed in is still fresh after signing out. The document route sets it only when a viewer was resolved and only for HTML; a stranger's page keeps `vary: Accept`, its ETag and `cache-control: no-cache` byte for byte. `Vary: Cookie` was deliberately **not** added: it would key every shared-cache entry by cookie and cost the public page its cacheability, and the only direction that leaks — a personalised page in a shared cache — is already closed by `private, no-store`. The refused-submission page does the same thing through `c.header`.

**Moderation.** Geekity has one role, so the person signing in is the person who would approve the comment. `submitComment` hands a signed-in submission to `intakeComment` with `origin: 'moderator'` rather than `'form'` — which is already the branch that approves on arrival and is never offered to a `CommentChecker`. No new rule was added to the intake; the existing one was reused, and `CommentOrigin`'s doc comment now names both ways a moderator's words arrive, so nobody later wonders why the Akismet call is not made.

## Decisions

- The signed-in form carries no `loaded` stamp and no honeypot, and `submitComment` skips both checks when `author` is set: they are there to catch a robot filling a public form, and a session is better evidence than either.
- The **per-address rate limit stays** for a signed-in commenter. It is not evidence about whether this is a person; it is a limit on what one address may do in ten minutes, and a stolen session is the case it would be wanted for.
- A name, email or website smuggled into a signed-in submission is ignored rather than refused. The form has no such boxes, so anything arriving in them was not typed by the person the session names.
- The account's email is never put on the render context. `signedInCommentForm` puts only `signedInAs: { name, url }` and `csrfToken` on the form; the email is read from the session again at submission time.
- `commentForm` and `refilledCommentForm` keep the signatures the package publishes; `signedInCommentForm(form, viewer)` is a pure function over a built form, so nothing already exported changed shape.
- `signedInCommenter` reads the session against the wall clock rather than `config.now()`, because that is the clock a session was minted against and the one the admin guard reads: a login must not outlive itself on the public site.

## Validation

- `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` — all clean. 2061 package tests and 30 demo tests pass, 0 failures.
- 14 new tests in `packages/cms/src/comments/signed-in.test.ts`, every one driven over HTTP through `createCms`.
- Exercised over real HTTP against a throwaway site on port 3111 (`geekity init`, first admin through `/admin/setup`, a real curl cookie jar, server stopped afterwards):
  - the `Set-Cookie` reads `Path=/`, and the jar sends it to the post's permalink;
  - signed out: `cache-control: no-cache`, an ETag, `vary: Accept`, the honeypot and the name, email, website and loaded fields;
  - signed in: `cache-control: private, no-store`, no ETag, only `post`, `in_reply_to`, `csrf_token` and `body`, and 'Commenting as Ada Lovelace' linking `/author/ada/`;
  - a submission with a wrong token → 403 and nothing written; with no token → 403 and nothing written; with the right one → 303 to `?comment=posted#comment-<id>` and a file entry `status: approved`, `author: { name: 'Ada Lovelace', url: '/author/ada/', email: 'ada@example.com' }` — with the email nowhere in the HTML;
  - a stranger's submission on the same site still lands `pending` under the name they typed, and the signed-in comment is on the page for them too;
  - a forged cookie gets the stranger's form and the cacheable headers back;
  - logging out clears the cookie at `Path=/` and the very next post page is the stranger's again.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A public request carrying a valid admin session now draws the short comment form — the comment box, the reply-to line and one sentence naming who it posts as, linked to their author archive — with no name, email, website, honeypot or loaded-at field, and the comment it stores is attributed from the account: display name or username, author archive as the website, and the account's email, which is stored and never shown.

The three sharp edges each have their own answer. **CSRF:** `COMMENT_FIELDS.csrf` is the admin's own `csrf_token`, the signed-in branch of `partials/comment-form.njk` renders it, and the endpoint checks it with `csrfTokenMatches` against the session, refusing with the admin guard's 403 and the guard's words; a stranger's form is asked for none. **Caching:** `representationResponse` gained `private`, which answers `Cache-Control: private, no-store` with no validator and no 304; the document route sets it only for an HTML page drawn for a viewer, and a stranger's page keeps `vary: Accept`, its ETag and `cache-control: no-cache` unchanged. **Moderation:** a signed-in submission reaches `intakeComment` as `origin: 'moderator'`, the branch that already approves on arrival and is never offered to a `CommentChecker`, and `CommentOrigin`'s doc comment now says so.

One thing the task did not name was needed for any of it to work in a browser: the session cookie was scoped `Path=/admin`, so it was never sent to a permalink. It is now `Path=/`, with `SameSite=Lax` and the new token carrying what the narrow path was buying; `admin/routes.test.ts` had the one assertion pinning the old path and now pins the new one with the reason.

Verified by 14 new HTTP-driven tests in `src/comments/signed-in.test.ts` covering all eight criteria, by the existing comment tests passing unedited, and by driving a real server with a real curl cookie jar: signed out and signed in headers, the short and long forms, a wrong token and a missing token both refused with nothing written, a right one approved on arrival and in `content/_data/comments/` with the account's email, a stranger's comment still held pending on the same site, a forged cookie falling back, and logging out putting the stranger's form back. `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
