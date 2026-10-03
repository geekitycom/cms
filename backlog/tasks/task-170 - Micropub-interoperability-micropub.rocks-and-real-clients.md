---
id: TASK-170
title: 'Micropub interoperability: micropub.rocks and real clients'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-29 01:55'
updated_date: '2026-10-03 16:16'
labels:
  - micropub
  - indieweb
  - docs
milestone: m-25
dependencies:
  - TASK-164
  - TASK-165
  - TASK-166
  - TASK-167
references:
  - 'https://micropub.rocks/'
  - 'https://quill.p3k.io/'
priority: medium
type: chore
ordinal: 194800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tests prove the endpoint against the spec as we read it; real clients prove it against the spec as they read it. Run the micropub.rocks server test suite against a deployed site, fix what fails, and post from Quill and one mobile client. Document Micropub in the README: which clients were tried, what the site accepts, and how a user connects a client and revokes it on the connected apps screen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every micropub.rocks server test that applies to the implemented features passes, and the results are noted on the task with any skipped tests explained
- [ ] #2 A note, an article, a reply and a photo post from Quill publish correctly, and a post from one mobile client (Indigenous or similar) publishes
- [x] #3 README documents Micropub support, the supported properties, and connecting and revoking a client
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pre-flight every micropub.rocks server test (100-805) against a local site with curl: boot the CMS on a temp copy of the demo content, mint tokens with issueTokens, replay each test's exact request from the micropub.rocks source (github.com/aaronpk/micropub.rocks views/server-tests) and check its pass condition.
2. Fix genuine spec failures with a failing test first. Found one: test 805, a token in both the header and the body, was accepted; RFC 6750 section 3.1 says 400 invalid_request. Fix in the bearer guard (bearer.ts), test in bearer.test.ts.
3. Leave failures that are deliberate or are micropub.rocks bugs, and record why: 204 (checkin, refused by decision-27), 804 (micropub.rocks wants 401, the Micropub spec says 403; micropub.rocks issue #101).
4. Read Quill's source for what it sends, to predict AC#2.
5. Rewrite the README Micropub section so it reads as one piece: what is supported, a property table, connecting a client, revoking it on Connected apps, and which clients were tried.
6. Record per-test results and the exact post-deploy runbook for AC#1 and AC#2 in the notes. Leave AC#1 and AC#2 unchecked: they need a deployed public site and real clients.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pre-flight of the micropub.rocks server tests (2026-10-02). Source of the test list: github.com/aaronpk/micropub.rocks, database/data.sql and views/server-tests/*.php, read for the exact request bodies and pass conditions. Each request was replayed with curl against a local site: the CMS booted on a temp copy of apps/demo/content (without _data/federation), user ada, tokens minted with issueTokens (create update delete media, plus a profile-only token for 804). Photo-by-URL tests used the real https://micropub.rocks/media/*.jpg URLs; multipart tests used the files from micropub.rocks/public/media.

Results (local):
- 100, 101, 104, 107 form creates: PASS (201 + Location; categories read back via q=source; photo URL rendered on the page).
- 200, 201, 202, 203, 205, 206 JSON creates: PASS (HTML content renders <b>/<i>; alt="Photo of a sunset" on the img; both photos shown).
- 204 nested checkin: FAIL by design. 400 'This endpoint does not understand checkin.' decision-27 refuses unmapped properties rather than drop them. Skip and explain on micropub.rocks.
- 300, 301 multipart photo(s), incl. photo[] parts: PASS (both uploads shown on the page).
- 400, 401, 402, 403, 404 updates: PASS (204; q=source shows the replaced content, test1+test2, test1, test1, no category).
- 405 non-array replace: PASS (400 invalid_request).
- 500, 501 delete form/JSON: PASS (204, page then 404). 502, 503 undelete: PASS (204, page back to 200).
- 600 q=config, 601 q=syndicate-to ([]), 602 q=source, 603 q=source properties[]: PASS.
- 700, 701, 702 media endpoint jpg/png/gif: PASS (201, Location serves image/jpeg, image/png, image/gif).
- 800 header token, 801 body token: PASS. 802 body token not stored: PASS locally (q=source has no access_token).
- 803 no token: PASS (401 error=unauthorized).
- 804 token without create scope: micropub.rocks FAIL by design. Site answers 403 insufficient_scope as the Micropub spec says; micropub.rocks wants 401 (open issue aaronpk/micropub.rocks#101).
- 805 token in header and body: was a genuine failure (201, post created). RFC 6750 section 3.1 says 400 invalid_request. Fixed in packages/cms/src/indieauth/bearer.ts with a failing test first in bearer.test.ts. Now 400 invalid_request. On micropub.rocks the status check passes and the body check fails, because it expects error 'bad request' (open issues #104, #122).
- Consequence of the 805 fix: micropub.rocks 802 will fail on the deployed run, because micropub.rocks sends 802's create with the token in both the header and the body (open issue #103, confirmed in views/server-tests/802.php: set_up_form_test without skipauth). 802's own point, that the token is not stored, passes locally.

Side effect on TASK-214: the guard now reads a form body even when a header token is present, so it catches a body it cannot parse and treats it as carrying no body token (the media test 'gets 400 for a body that is not multipart' caught the regression before the catch). A token-less malformed form body now answers 401 unauthorized instead of 500. TASK-214 still wants 400 invalid_request for that case and is not fixed here.

Quill pre-read (github.com/aaronpk/Quill source, not a live run): Quill asks for scope 'create update media profile'. Its note form sends h, content, name, in-reply-to, category[], mp-syndicate-to[], mp-slug, published and photo / photo[] as URLs after uploading to the media endpoint, all accepted. Predicted AC#2 risks: (1) a photo with alt text is sent form-encoded as photo[value] and photo[alt]; the endpoint answers 400 'does not understand photo[value], photo[alt]' (reproduced locally with curl). (2) location, if the user turns on the location toggle, is refused by decision-27. (3) rsvp and visibility only appear when the site offers them, which it does not. Not fixed here: photo[value]/photo[alt] is a Quill convention, not the Micropub spec, and needs a decision and a follow-up task.

Runbook after deploy (AC#1, AC#2):
1. micropub.rocks: sign in at https://micropub.rocks/ with the site URL, approve all scopes on the consent screen, then run every server test: 100, 101, 104, 107, 200-206, 300, 301, 400-405, 500-503, 600-603, 700-702, 800-805. For 804, make a second token with only the profile scope (sign in again and untick create/update/delete/media) and paste it. Expected: all pass except 204 (checkin, decision-27), 804 (#101), 805 body check (#104) and 802 (#103). Record each result here.
2. Quill (https://quill.p3k.io/): sign in with the site URL. Post a note (content + two categories), an article (title + HTML body in the editor), a reply (Reply interface, in-reply-to a real post URL), and a photo post (note with an uploaded photo, no alt text). Check each page, its h-entry, and the post file under content/posts. Also try a photo with alt text and record the 400 if it still happens.
3. Mobile: post a note from one Micropub app on a phone, for example Indigenous (Android/iOS) if it still installs, or iA Writer's Micropub publishing. Record which app and version.
4. Revoke Quill on Users > Connected apps and confirm its next post gets 401 invalid_token.

AC#1 and AC#2 stay unchecked: both need a public deployed site and real clients.

AC#3: README.md ## Micropub rewritten as one section (it was ### Micropub under Signing in, extended seven times). Covers what the endpoint does, connecting an app with a scope table matching consent.ts SCOPE_LABELS, disconnecting on Users > Connected apps (/admin/users/apps), sending the token, a property table for create, update/delete/undelete, queries, the media endpoint, and the micropub.rocks results. The IndieAuth paragraph on sending a token also notes the new 400. Gates: pnpm build, pnpm test (3404 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.

2026-10-02: micropub.rocks cannot sign in to the site (2017 IndieAuth client, no PKCE, no metadata discovery), and legacy IndieAuth will not be supported (TASK-219). Running its server tests needs its Manual tab: endpoint https://shll.me/_geekity/micropub plus an access token obtained some other way. See TASK-219 for the Create token proposal.

2026-10-03, micropub.rocks against shll.me on 0.18.0 (signed in via a created token or the PKCE allowlist): test 204 answers 400 'does not understand checkin', as expected by design until TASK-236 maps checkin onto the post's location.

2026-10-03: micropub.rocks test 700 answers 403 insufficient_scope, because micropub.rocks requests 'create update delete undelete' and the media endpoint requires media. Filed as TASK-238 (accept create or media there).

2026-10-03 correction: micropub.rocks test 804 answers 403 insufficient_scope. Earlier notes and the README said 403 is what the Micropub spec says; it is not. The Micropub spec's error table (section 3.8) gives insufficient_scope as 401; RFC 6750 gives 403. Filed as TASK-239 (401 on the Micropub endpoints).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Pre-flighted every micropub.rocks server test against a local site with curl and recorded each result. Fixed the one genuine spec failure (805): the bearer guard now answers 400 invalid_request when the token arrives in both the header and the body, per RFC 6750 section 3.1, test first in bearer.test.ts. Rewrote the README's Micropub documentation as one coherent section with a property table, connecting and disconnecting an app, and the conformance results. Verified with the curl pre-flight and pnpm build/test/typecheck/lint/format:check. Still open: AC#1 (micropub.rocks against a deployed site) and AC#2 (Quill and a mobile app); the notes carry the runbook and the predicted Quill alt-text gap.
<!-- SECTION:FINAL_SUMMARY:END -->
