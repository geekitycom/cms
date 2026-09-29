---
id: TASK-155
title: >-
  Syndication targets: webmention-driven POSSE (IndieNews, Bridgy Publish)
  chosen per post or by tag
status: To Do
assignee: []
created_date: '2026-09-29 01:32'
updated_date: '2026-09-29 02:13'
labels:
  - webmention
  - indieweb
milestone: m-25
dependencies: []
references:
  - 'https://news.indieweb.org/how-to-submit-a-post'
  - 'https://brid.gy/about#publish'
  - 'https://indieweb.org/POSSE'
  - 'https://www.w3.org/TR/micropub/#syndication-targets'
documentation:
  - backlog/docs/doc-7 - Webmentions.md
priority: medium
type: feature
ordinal: 179800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Services such as IndieNews (https://news.indieweb.org/how-to-submit-a-post) and Bridgy Publish take a post when it links to them and sends them a webmention, and they answer with a Location header naming the copy they made. The CMS already sends a webmention to every external link in a post body (doc-7), but nothing lets an author add such a link without typing it into the body, nothing records the Location that comes back, and there is no tag shortcut like the WordPress IndieNews plugin, which syndicated any post tagged indienews. Build this generically, with no service hard-coded: a site-level list of syndication targets (id, name, URL to link to, optional tag), kept as a content file per decision-9. A post picks targets explicitly (Micropub name: syndicate-to) or implicitly by carrying a target tag. The theme renders a visible link to each chosen target inside the h-entry, the sender adds the target URLs to the links it notifies (as it already does for in-reply-to), and the URL each target returns is recorded and rendered as u-syndication. Authors can also list syndication URLs by hand (for copies posted manually). Where returned URLs are stored is a decision for planning: in the post front matter (syndication) or, following decision-19 for reply contexts, a _data file keyed by post so a background job never rewrites a file open in the editor. Per-language targets (IndieNews has /en, /de and so on) are TASK-156 (M24), not this task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A site declares syndication targets in a content file with an id, a display name, a URL and an optional tag; invalid entries are reported at boot and ignored; no target is built in
- [ ] #2 A post selects targets with a syndicate-to front matter list, and the post editor offers each declared target as a checkbox
- [ ] #3 A post carrying a target's tag selects that target without being listed in syndicate-to
- [ ] #4 The default theme renders a visible link to each selected target inside the post's h-entry, marked up the way IndieNews and Bridgy Publish require
- [ ] #5 Publishing or updating a post sends a webmention to each selected target through the existing sender, with no request made while a page is served
- [ ] #6 The URL a target returns in Location (201 or 202) is stored durably and rendered on the post as a u-syndication link; the storage location is recorded as a decision
- [ ] #7 Authors can add syndication URLs by hand in front matter, rendered the same way
- [ ] #8 Deselecting a target (removing the tag or the entry) removes its link and the sender notifies the target, as it does for any unlinked page
- [ ] #9 The federation screen shows each target's outcome per post, and Resend re-sends to targets
- [ ] #10 README documents targets with IndieNews and Bridgy Publish as worked examples
- [ ] #11 Verified by submitting a real post to IndieNews from a public site, or the notes say why it could not be
<!-- AC:END -->
