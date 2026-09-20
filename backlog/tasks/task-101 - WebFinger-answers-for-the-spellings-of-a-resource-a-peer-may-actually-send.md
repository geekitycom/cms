---
id: TASK-101
title: WebFinger answers for the spellings of a resource a peer may actually send
status: To Do
assignee: []
created_date: '2026-09-20 11:35'
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
- [ ] #1 acct:a@EXAMPLE.COM resolves to the same user as acct:a@example.com, proven by a test
- [ ] #2 acct:@a@example.com and the bare @a@example.com both resolve, proven by a test
- [ ] #3 A username that differs in case does not resolve, and a test says so, so this stays deliberate rather than accidental
- [ ] #4 An actor URL whose host differs in case still resolves, proven by a test
- [ ] #5 The subject the answer carries is the site's own spelling, whatever spelling was asked for
<!-- AC:END -->
