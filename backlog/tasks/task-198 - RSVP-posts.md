---
id: TASK-198
title: RSVP posts
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:01'
updated_date: '2026-10-06 03:32'
labels:
  - indieweb
  - post-types
  - webmention
milestone: m-28
dependencies:
  - TASK-169
references:
  - packages/cms/src/content/post-type.ts
  - 'https://indieweb.org/rsvp'
priority: low
type: feature
ordinal: 214800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 4 asks to publish RSVP posts and send webmentions to events. PostType is reply | note | article. Add an RSVP post: in-reply-to an event URL plus rsvp yes, no, maybe or interested, rendered as an h-entry with p-rsvp and a reply context for the event (its name, start date and location), with the webmention sent to the event. Post type discovery puts rsvp ahead of reply. Federate it as a Note replying to the event, or as an ActivityStreams Accept/TentativeAccept/Reject of an Event when the target is a fediverse event.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post with in-reply-to and rsvp renders as an RSVP with p-rsvp and the event's reply context
- [x] #2 Publishing it sends a webmention to the event URL
- [x] #3 Post type discovery reports rsvp for it, and the admin editor can create one
- [x] #4 Incoming RSVP webmentions on posts are shown as RSVPs rather than generic replies
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: front matter 'rsvp' (yes|no|maybe|interested) beside in-reply-to, kept in Document.extra under its mf2 name, read only through content/rsvp.ts: RSVP_VALUES, RsvpValue, rsvpValue, rsvpOf, RSVP_LABELS (Going, Not going, Maybe, Interested), RSVP_PHRASES (Going to, Not going to, Maybe going to, Interested in), rsvpLine. TASK-200 reuses the same module for RSVPs it receives.
1. Post Type Discovery: PostType gains 'rsvp', checked first as the spec orders it (event, rsvp, repost, like, reply ...): any of the four values makes an rsvp, as the spec says. Tests first.
2. Reply context: the cited page's h-event (name, summary, dt-start, p-location) and a JSON-LD Event (name, description, startDate, location name) are sources; ReplyContext gains 'start' (an instant when the page gives a zone, the date/time as written when floating) and 'location'. parseContexts keeps both. Amend decision-19.
3. Theme: context gains rsvp {value,label,line}; partials/rsvp.njk prints the p-rsvp line at the top of e-content; reply-context.njk says 'RSVP to' and prints dt-start and p-location inside the h-cite, a floating start in UTC; kicker and hidden h1 say RSVP. Feeds open with 'Going to <event>' and the p-rsvp line.
4. Webmentions: the event is the in-reply-to, already a target. An RSVP to a silo copy follows the original exactly as a reply does, because both act on in-reply-to.
5. Editor: an RSVP select in Responding to; writeDocument refuses an unknown value and an rsvp without In reply to; resolveExtra writes/removes 'rsvp'; formFor and preview carry it; slug prefix 'rsvp-'. Micropub create/update/q=source accept rsvp and q=config lists RSVP.
6. Federation: a Note with inReplyTo the event, content opening 'Going to <a>Event</a>'. Accept/TentativeAccept/Reject left out; decision-31.
7. Incoming: sourceEntry reads a reply entry's p-rsvp; CommentRecord gains optional 'rsvp' (comment file + admin index migration 22 column); a resent webmention replaces or removes it; conversation Interaction carries {value,label}; conversation.njk prints a p-rsvp on the comment.
8. Docs: theme README, README Micropub, doc-2. Verify build/test/typecheck/lint/format and curl a served scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Order: after TASK-169 (M26). Like, repost and bookmark posts extend PostType and post type discovery first; RSVP is one more type in the same structure, and Micropub create (TASK-164, before TASK-169) is how most clients will send one.

Data shape: rsvp lives in Document.extra under its mf2 name and is read only through content/rsvp.ts (RSVP_VALUES, RsvpValue, rsvpValue, rsvpOf, RSVP_LABELS, RSVP_PHRASES, rsvpLine). TASK-200 should reuse RsvpValue, rsvpValue and RSVP_LABELS for RSVPs to the site's own events.
Post Type Discovery: rsvp is checked first, and any of the four values (case-insensitive in the file) makes an rsvp whether or not in-reply-to is set, as the spec says. The editor and Micropub refuse an RSVP without In reply to.
Silo copies (TASK-197): an RSVP to a silo copy of an event follows the original exactly as a reply does. Every original-post-discovery path keys on in-reply-to (replyTarget, reply-context.njk, the webmention sender, repliedTo in federation), never on the post type, so no code changed; web/rsvp.test.ts proves the page cites the original and keeps the copy as a second u-in-reply-to.
Event context: h-event (after h-entry) and JSON-LD Event (after the posting types) are new sources in webmention/reply-context.ts; ReplyContext gains start and location (decision-19 amendment). A start with no zone is kept as written and printed in UTC so the site's zone cannot move it a day.
Federation (decision-31): a Note replying to the event whose content opens 'Going to <a>Event</a>'. No Accept/TentativeAccept/Reject/Join; Mobilizon participation is left out and recorded as a consequence.
Incoming: a webmention reply whose h-entry carries a valid p-rsvp stores rsvp on its comment (content/_data/comments file and admin index column via migration 22); kind stays 'reply' so threading, counts and moderation are unchanged; a resend replaces or removes the rsvp. The default theme prints a data.p-rsvp at the top of the comment.
Micropub: rsvp mapped in create SINGLE_VALUED, update UPDATABLE and q=source; q=config lists RSVP with in-reply-to and rsvp required. The old refusal test that sent rsvp now sends ate.
Validation: pnpm build, pnpm test (4751 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. Served a scratch site built from dist on :3918 (event host .invalid, its context seeded, no outside fetch) and curled /2026/09/camp/, / and /feed/json/: kicker RSVP, h-cite 'RSVP to IndieWeb Camp Chicago, 10 October 2026, Chicago Public Library' with dt-start and p-location, data.p-rsvp value=yes in the content and in the listing, feed line 'Going to …'. Parsed the served page with webmention/microformats sourceEntry: kind reply, rsvp yes. Server stopped. A mutation (dropping rsvp from the comment file writer) fails the rebuild test.
Seen, not fixed: the full suite logs 'Could not send a webmention … https://brid.gy/publish/webmention answered 400' from editor-layout.test.ts, which declares a brid.gy syndication target and does not stub fetch, so that existing test may reach brid.gy. Not touched by this task.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added RSVP posts. A post with in-reply-to and rsvp (yes, no, maybe or interested) is typed rsvp by Post Type Discovery ahead of every other type; content/rsvp.ts is the one reader of the value and holds the labels and phrases TASK-200 can reuse. The default theme opens its content with a data.p-rsvp, cites the event as 'RSVP to' its name with its dt-start and p-location (read from the event's h-event or JSON-LD Event and stored in replyContexts.json, decision-19 amended), and says RSVP in the kicker; feeds open with 'Going to <event>'. Publishing sends the event a webmention, as a reply does, and an RSVP to a silo copy cites the original as a reply does. It federates as a Note replying to the event (decision-31). The admin editor has an RSVP select and refuses an RSVP with no In reply to; Micropub create, update and q=source take rsvp and q=config lists RSVP. An incoming webmention reply with a p-rsvp is stored with its rsvp (comment file and index migration 22) and shown with a p-rsvp in the thread. Verified with new tests (post-type, editor, micropub create/update/config, webmention send and receive, reply-context event sources, web page and feed, federation), the full build/test/typecheck/lint/format:check run, and curl plus an mf2 parse of a served scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
