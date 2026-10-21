---
id: TASK-433
title: The post editor starts by choosing a kind and shows only that kind's fields
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 01:15'
updated_date: '2026-10-20 02:36'
labels:
  - admin
milestone: m-40
dependencies:
  - TASK-432
references:
  - _local/editor-mockups/a-picker.html
  - _local/editor-mockups/shared/forms.js
  - packages/cms/admin/pages/documents/editor.njk
priority: high
ordinal: 370800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The editor at /admin/posts/new and /admin/posts/{slug} shows every property at once: photos, location, recording, responding to, event, read, and more. That is hard to use and invites mistakes. Replace it with the layout chosen from _local/editor-mockups (option A, a-picker.html): "+ New" opens a grid of kinds; choosing one opens a short form with only that kind's fields. A "Change type" menu in the heading switches it. Fields every kind shares move to a slimmer sidebar.

Kinds: Note (an optional title makes it an article), Photo, Link (replies to, likes, reposts or bookmarks), RSVP, Event, Check-in, Episode (audio or video with an enclosure), Review (from the review task) and Page. Pages > Add new opens the Page form directly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /admin/posts/new shows the kinds as a grid, each with a name and one line saying what it is for, and each opens its own form
- [x] #2 Each kind's form shows only its own fields, as in the mockup; a Read section is gone and Photo has a library picker with alt text per photo
- [x] #3 The sidebar holds Publish (save draft, publish or update, when, visibility, author), Tags and categories, Location (except Check-in and Event), Address, Summary and language, Syndicate to, and Display and discussion
- [x] #4 Change type switches the form and keeps the title, body, tags and other shared values
- [x] #5 Editing an existing post opens on the kind post type discovery gives it
- [x] #6 A post with properties from more than one kind (such as a Micropub reply with photos) still shows and saves every property it has; nothing is dropped by editing it
- [x] #7 Plugin editor actions (title, description and tag suggestions) still appear next to their fields
- [x] #8 The chooser and every form work with JavaScript switched off
- [x] #9 doc-5 and the admin docs describe the new editor
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add src/admin/editor-kinds.ts: the post kinds (note, photo, link, rsvp, event, checkin, episode, review) plus page for the chooser, each with label, one-line blurb, icon, title rule, body label and its own writing-column sections; discovery from the form through discoverPostType (reply/like/repost/bookmark -> link, article -> note, a note or photo with an enclosure -> episode, with a check-in location -> checkin).
2. editor-layout.ts: which sections a form shows for a kind (its own, then any other section the form fills, as 'Also on this post'), and the sidebar groups that remain collapses.
3. documents.ts: GET /admin/posts/new without ?kind= renders a chooser grid (new pages/documents/chooser.njk); ?kind=<kind> opens that kind's form; the form carries a hidden kind; a POST with switch-kind re-renders the submitted form on another kind without saving (Change type with no script; the same POST adds ticked library photos). Existing posts open on the discovered kind. submittedForm maps the Link section's one choice + address (link-verb, link-url) onto in-reply-to/like-of/repost-of/bookmark-of.
4. Rewrite editor.njk: heading with Change type menu (popover of submit buttons), main card with title (when the kind has one or the form holds one), the kind's sections, body with a per-kind label; also-has sections after; sidebar Publish card (buttons, draft, when, visibility, author), Tags and categories, Location (not check-in; event only when filled), Address, Summary and language, Syndicate to, Display and discussion (comments, pinned / contact, hide from collections). Photo section: rows with thumbnail + alt text + address, a library picker of checkbox thumbnails numbered after the rows, and a web-address row. Review section: item kind as a radio join; per-kind fields and labels shown by Tailwind group-has variants (no script needed); star rating radios with a Clear label; item picture labelled per kind; place review shows the photo picker.
5. Tests first for each AC (new src/admin/editor-kinds.test.ts), then update existing editor tests for the new layout.
6. Docs: doc-5 Editor section and docs/admin.md.
7. Verify: pnpm build, test, test:11ty, typecheck, lint, format:check; Playwright drive JS on/off, 390px, CSP console.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned.
- Kinds live in src/admin/editor-kinds.ts (EDITOR_KINDS, discoveredKind, REVIEW_EDITOR_WORDS). A kind is a layout only; discovery runs discoverPostType over the form, then a note/photo with an enclosure is an Episode and one with a check-in location a Check-in.
- editor-layout.ts: editorSections(kind, form) gives the kind's own blocks and the other kinds' blocks the form fills (shown under 'Also on this post', open), so nothing is dropped. sidebarLocation() hides Location on a check-in and on an event without one. GROUPS lost photos/recording/responding/event/review/publishing; display now opens for pinned.
- Routes: GET /admin/posts/new is the chooser (new template pages/documents/chooser.njk, ADMIN_TEMPLATES.documentChooser); ?kind=<kind> opens that form. POST with switch-kind=<kind> (Change type popover, and 'Add the ticked photos') re-renders the submitted form on that kind without saving. Hidden 'kind' field keeps a refused save on its kind.
- Link: link-verb + link-url mapped in submittedForm (withLink); a named property field in the body wins, so Micropub-shaped posts and old clients still work. RSVP keeps its own in-reply-to box.
- Photos: picker ticks are named photo-url-<n> after the rows, so readPhotoForm needs no change. Thumbnail helper moved to images/variants.ts thumbnailUrl() and shared with the media library.
- Review: per-item-kind fields and labels via Tailwind group-has variants written in an ITEM_KIND_SHOWS modifier map (styles.test forbids interpolated classes); unrecognized kind ticks with data-as-other. Star rating radios with a Clear label for the hidden none radio. Radio groups carry aria-invalid on their first input when refused.
- Tests: new src/admin/editor-kinds.test.ts (14 tests, failed first for the right reasons). Updated editor tests for the new layout; posts.test submit() now posts every field the form has (fieldsOf), with undefined unticking a box. Plugin tests now open /admin/posts/new?kind=note.
- Verified: pnpm build, pnpm test (cms 6279 pass, all packages pass), pnpm test:11ty, typecheck, lint, format:check all exit 0. Playwright/Chromium against a scratch site on :3433, JS on and off at 1280 and 390: 148/148 checks (chooser 9 cards, photo pick+add+alt+save, change type keeps title/body/tags, review kinds switch fields/labels with no script, stars + Clear, review saves and reopens, mixed reply+photo opens as Link with Also on this post, no horizontal scroll, no console/CSP errors). Screenshots in the session scratchpad task433/.
- Docs: doc-5 Editor section (Kinds, Kind fields, Layout, route table) and docs/admin.md (Kinds of post).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The post editor now starts at a kind chooser (/admin/posts/new) and each kind (Note, Photo, Link, RSVP, Event, Check-in, Episode, Review, plus Page) has a short form with only its fields; Change type re-lays the submitted form without saving; existing posts open on their discovered kind and show other kinds' properties under Also on this post so saves keep them; the sidebar holds Publish, Tags and categories, Location, Address, Summary and language, Syndicate to, Display and discussion. Works with JS off (links, submit buttons, CSS group-has for review kinds). Verified with new editor-kinds tests, the full test/test:11ty/typecheck/lint/format runs, and a Playwright pass with JS on and off at 1280 and 390 px.
<!-- SECTION:FINAL_SUMMARY:END -->
