---
id: TASK-539
title: >-
  Editor preview reads the form the way a save does, so every post kind previews
  as itself
status: Done
assignee:
  - '@claude'
created_date: '2026-10-31T14:51:00Z'
updated_date: '2026-10-31T14:58:00Z'
labels:
  - admin
  - editor
dependencies: []
type: bug
ordinal: 441800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The admin editor's Preview tab posts the form to /admin/preview, and packages/cms/src/admin/preview.ts builds a throwaway Document from raw form fields itself. It reads in-reply-to, repost-of, like-of, bookmark-of, rsvp, event and review fields, but not the link editor's link-verb + link-url pair (translated only by submittedForm/withLink in admin/documents.ts), photos, the episode enclosure or the check-in place. So a new link post that replies to a URL previews as an Article (or Note) instead of a Reply/Like/Repost/Bookmark, and photo posts preview without their photos. Fix: build the preview document's inReplyTo and extra through submittedForm + formInReplyTo + extraFromForm, the same path writeDocument uses, so the preview cannot drift from a save again.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A link post whose verb is Replies to and address is a URL previews as a reply, with the reply context the published page would show
- [x] #2 Likes, Reposts and Bookmarks chosen in the link editor preview as like, repost and bookmark
- [x] #3 A photo post previews with its photos
- [x] #4 Preview builds inReplyTo and extra front matter through the same form functions the save uses, not its own field parsing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing preview tests for link verbs and photos. 2. Build the preview document's inReplyTo and extra via submittedForm, formInReplyTo and extraFromForm with lenient media (copyMedia). 3. Move PREVIEW_PATH to site/admin-paths.ts so preview.ts can import documents.ts without a cycle.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
preview.ts no longer parses citations, RSVP, event or review fields itself; extraFromForm writes them as the save does. copyMedia now takes an optional document and is exported. Check-in places still do not show in the preview: they live in the post-locations store keyed by permalink, not in front matter. Verified: new editor.test.ts cases (Reply/Like/Repost/Bookmark kicker and h-cite, photo img) fail before and pass after; pnpm lint clean; pnpm test all pass (cms 7928/7928).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The editor preview now builds its throwaway document through the same form functions a save uses (submittedForm, formInReplyTo, extraFromForm), so a link post previews as the Reply, Like, Repost or Bookmark it will be published as, and photo posts preview with their photos. Event, RSVP and review previews keep working through the shared path. Check-in places are still missing from the preview.
<!-- SECTION:FINAL_SUMMARY:END -->
