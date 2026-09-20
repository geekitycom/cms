---
id: TASK-101
title: WebFinger answers for the spellings of a resource a peer may actually send
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 11:35'
updated_date: '2026-09-20 11:46'
labels:
  - federation
  - web
dependencies: []
references:
  - packages/cms/src/federation/mount.ts
  - packages/cms/src/federation/federation.test.ts
type: bug
ordinal: 126800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`webFingerSubject` (federation/mount.ts:351) compares the `resource` query to each spelling of a user as an exact string, so anything that differs only in case or punctuation is a 404 and reads to the person searching as an account that does not exist.

Checked against the live site:

    acct:a@shll.me    200
    acct:A@shll.me    404
    acct:a@SHLL.ME    404
    acct:@a@shll.me   404

The second is arguably right. Geekity treats usernames as case-sensitive — `findUser` matches a username exactly while matching an email whatever its case — so `A` really is not `a`, and this task should leave that alone rather than quietly make two accounts collide.

The third is a plain bug. A host name is case-insensitive, in DNS, in RFC 3986 and in RFC 7033, so `acct:a@SHLL.ME` names the same person as `acct:a@shll.me` and must resolve. Anything that upper-cases or title-cases the domain on its way through a client, a search box or a copy-paste hits this.

The fourth is the leniency the code already grants elsewhere: the comment on the bare `user@host` branch says a spelling is accepted because refusing it 'would only look like a missing account', and a leading `@` is the same case. `@a@shll.me` is how the handle is written everywhere a person reads it.

Normalize the resource once before matching rather than adding a branch per spelling: trim, drop a leading `@` after the optional `acct:`, and compare the host case-insensitively while comparing the username exactly. A URL resource should match its host case-insensitively too, for the same reason.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 acct:a@EXAMPLE.COM resolves to the same user as acct:a@example.com, proven by a test
- [x] #2 acct:@a@example.com and the bare @a@example.com both resolve, proven by a test
- [x] #3 A username that differs in case does not resolve, and a test says so, so this stays deliberate rather than accidental
- [x] #4 An actor URL whose host differs in case still resolves, proven by a test
- [x] #5 The subject the answer carries is the site's own spelling, whatever spelling was asked for
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Test at the existing seam: the WebFinger route in packages/cms/src/federation/federation.test.ts, through the file's `webFinger(instance, resource)` helper, one failing test per acceptance criterion before the code.
2. Add a private `canonicalResource` to packages/cms/src/federation/mount.ts that normalizes one resource string once: trim; a URL-shaped resource (a scheme with an authority) goes through `new URL`, which lower-cases scheme and host and leaves the path alone; anything else has an optional `acct:` prefix and then a leading `@` stripped, its host lower-cased at the last `@`, and comes back as `acct:{username}@{host}`.
3. Have `webFingerSubject` compare the canonical form of the asked-for resource with the canonical form of each spelling it already knows — the acct handle, the author archive, `/@{username}` and a stored actor id — instead of comparing raw strings. The bare `user@host` branch folds into this, because canonicalization supplies the missing `acct:`; keep its reasoning in the doc comment.
4. The username keeps its case: only the host is lower-cased, so `acct:A@host` stays a 404, and a test pins that.
5. The answer is unchanged: `subject` is still built from the site's own spelling via `acctOf`, so whatever was asked, the JRD carries the site's.
6. Verify with pnpm build, test, typecheck, lint and format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Normalized once instead of a branch per spelling. `canonicalResource` in packages/cms/src/federation/mount.ts reduces a resource to the spelling every equivalent one shares: trim; a resource with a scheme and an authority goes through `new URL`, which lower-cases scheme and host and leaves the path alone; otherwise an optional `acct:` prefix and then a leading `@` come off, and the host after the last `@` is lower-cased, giving `acct:{username}@{host}` back. `webFingerSubject` now canonicalizes both sides and compares the result against each spelling it already knew, so the bare `user@host` branch folded into the same comparison rather than needing one of its own; its reasoning moved into the new doc comment.

The username keeps its case deliberately: only the segment after the last `@` is lower-cased, because `findUser` compares a username exactly and making `Ada` and `ada` the same person here would be a security-relevant collision, not a leniency.

The answer never changed: `subject` is still `acctOf(user.username, baseUrl)` and the aliases still come from `actorAliases`, so whatever spelling was asked for, the JRD carries the site's own.

Mutation-checked both new behaviors rather than trusting a green run: disabling the URL branch turns the AC #4 and AC #5 tests red, and lower-casing the username alongside the host turns the AC #3 test red.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
WebFinger now matches a resource by its meaning rather than its typing. A new `canonicalResource` in packages/cms/src/federation/mount.ts normalizes one resource string once — trim, optional `acct:`, optional leading `@`, host lower-cased, a URL through `new URL` — and `webFingerSubject` compares the canonical form of what was asked with the canonical form of each spelling it already answered for, so `acct:ada@EXAMPLE.COM`, `acct:@ada@example.com`, `@ada@example.com` and an actor URL with an upper-cased host all resolve to the person they name. A username still has to match exactly, and a test pins that, because Geekity compares usernames case sensitively and two accounts must not collide here. The answer is unchanged: the subject is always the site's own spelling.

Verified by five new tests in packages/cms/src/federation/federation.test.ts driven through the WebFinger route, one per acceptance criterion; the whole suite passes (2023 tests, 0 failures) along with pnpm build, typecheck and lint, and prettier passes on both changed files. Each new behavior was mutation-checked: disabling the URL branch turns the AC #4 and AC #5 tests red, and lower-casing the username turns the AC #3 test red.
<!-- SECTION:FINAL_SUMMARY:END -->
