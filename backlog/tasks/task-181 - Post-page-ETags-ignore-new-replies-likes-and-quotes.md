---
id: TASK-181
title: 'Post page ETags ignore new replies, likes and quotes'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 02:30'
updated_date: '2026-09-30 00:41'
labels:
  - bug
  - web
milestone: m-20
dependencies: []
priority: medium
type: bug
ordinal: 205800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In production (watch off) the HTML representation of a post is served with Cache-Control no-cache and an ETag of representationEtag(representation, document.hash) (packages/cms/src/web/routes.ts, the validated branch near line 617). document.hash covers only the post file, but the page also renders its conversation: fediverse replies, native comments, webmentions, likes, boosts and, since TASK-171, approved quotes. When one of those arrives, a browser revalidating the page sends If-None-Match, gets 304, and keeps showing the old conversation until a hard reload; a shared cache does the same for everybody. The .md and .json representations do not render the conversation and are unaffected.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post page's validator changes when anything its conversation shows changes: a reply, like, boost, mention or quote arriving, being approved, withdrawn or deleted
- [x] #2 A conditional GET after a new reply returns 200 with the reply, and one with nothing new still returns 304, proven by tests
- [x] #3 Last-Modified agrees with the ETag (the later of the post's and its conversation's last change), or is omitted
- [x] #4 Computing the validator adds no per-request file reads beyond what rendering the conversation already does
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests in web/site.test.ts: the post page ETag changes on a reply, like, boost, a replier being named and a delete; a conditional GET after a new reply is 200 with the reply and one with nothing new is 304, over identity and br.
2. In negotiateDocument (web/routes.ts), validate the HTML representation by a hash of the body it rendered instead of document.hash, and omit Last-Modified on HTML (nothing records when a withdrawal happened, so no date can agree). Markdown and JSON keep document.hash and lastModifiedOf.
3. The body hash also covers theme edits, so drop the watch-mode exception that withheld the HTML validator; replace its test with one proving a template edit under watch turns a 304 into a 200.
4. Update the negotiation test that expected Last-Modified on HTML, regenerate the anonymous golden file and review its diff.
5. pnpm build, test, typecheck, lint, format:check; curl a copy of the demo on a spare port.

6. Review fix: the comment and contact forms carry a per-request loaded-at stamp, so a hash of the sent page never repeated. Renderer.renderPage draws the page with each stamp replaced by a random per-renderer mark, fingerprints that, and puts the real stamps back. The fingerprint also carries the 12-hour window of each stamp the theme printed, so a 304 never hands back a stamp older than half MAXIMUM_FORM_AGE_SECONDS.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Approach: the HTML ETag is representationEtag('html', <rendered page>). Any input the page draws (conversation from ap_inbox and comments, quote authorizations, actor_profiles names and avatars, neighbours, archive, theme) moves it, so the validator cannot miss a source the renderer reads. The cost is one sha256 over a string already in memory; the 304 path already rendered the page before this change, so no read was added (AC #4).
Last-Modified: dropped for every HTML document representation (posts, pages, front page). A deletion or withdrawal leaves no timestamp, so no date could agree with the ETag; the AC allows omission. Markdown and JSON keep their document-hash ETag and Last-Modified.
Watch mode: the old code withheld the HTML ETag while watching because the theme could change unseen. A body hash sees theme edits, so the exception is gone and dev servers now revalidate HTML too. negotiation.test.ts 'withholds the HTML validator while the watcher is on' was replaced by site.test.ts 'follows a template edited under a watching server'.
Golden: anonymous-pages.golden.json changes only document HTML entries (post and page ETags, three last-modified lines removed); listing entries are unchanged.
Listing HTML (home, archives) still uses document hashes and is out of scope; it does not render conversations.
Validation: pnpm build, pnpm test (2530 + 31 pass), typecheck, lint, format:check all exit 0. The new tests fail against the old routes.ts (ETag unchanged after a reply; Last-Modified present). Curl against a demo copy on :3917 with watch off: 200 then 304 on the same ETag, W/ ETag 304 with Accept-Encoding br, Markdown still has Last-Modified; after inserting a reply row into ap_inbox the old ETag (plain and W/) gets 200 with the reply in the body and a new ETag; deleting the row returns the original ETag. Server stopped by PID.

Review fix (orchestrator): the first version hashed the sent page. The comment form's loaded stamp (comments/form.ts) and the contact form's (contact/form.ts) change every millisecond, so a post taking comments or a contact page never got a 304. The curl check missed it because every demo post is past its comment window; only /contact/ has a form.
Fix: new Renderer.renderPage(document, { frontPage, extra, viewer }) returns { html, fingerprint }. renderDocument and renderFrontPage now delegate to it and return .html. documentPage swaps each form's loaded value for a mark (geekity-stamp-<uuid per renderer>-comment|contact), renders, and makes the fingerprint from that render plus floor(loaded / 12h) for each mark that was printed. It then replaces the marks with the real stamps. negotiateDocument hashes page.fingerprint.
The window keeps 304s from handing back a form that has gone stale: MAXIMUM_FORM_AGE_SECONDS is 24h, so a revalidated stamp is at most 12h old. Only printed stamps count, so a theme that shows no form (the golden's bare theme) has a clock-free ETag.
Other per-request values checked: the anonymous form has no CSRF token (only the signed-in form, and signed-in pages are private with no validator); no nonce is rendered; the theme's only clock read is {{ "now" | date("year") }}, which changes once a year. The comment-open check reads the clock, but that is a real change to the page.
Tests: comments/site.test.ts 'revalidating a post that takes comments (TASK-181)' covers a 304 with the same ETag after the clock moves 1s and a fresh stamp on a 200, a 200 after 24h, and an ETag change on approval. contact/site.test.ts 'revalidating the contact page (TASK-181)' covers the same for the contact page. The first test fails against the page-hash version, and the 24h test fails with the window removed. Full gate exits 0 (2534 + 31 pass). Curl against a demo copy: /contact/ gives 304 after a second, the same ETag on the next 200 with a new stamp, and a W/ ETag 304 over br. Server stopped by PID.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Post and page HTML is now validated by a hash of the rendered page instead of the post file's hash, so a reply, like, boost, mention, quote, approval, deletion or profile refresh changes the ETag and a revalidating browser or shared cache gets the new conversation instead of a 304. HTML no longer carries Last-Modified because no date tracks withdrawals; Markdown and JSON are unchanged. The watch-mode exception that withheld HTML ETags is removed since the hash now sees theme edits. Verified with new tests in web/site.test.ts (validator changes per interaction kind; conditional GET 200 after a reply and 304 otherwise over identity and br; template edit under watch), the regenerated golden file, the full build/test/typecheck/lint/format run, and curl against a demo copy.
<!-- SECTION:FINAL_SUMMARY:END -->
