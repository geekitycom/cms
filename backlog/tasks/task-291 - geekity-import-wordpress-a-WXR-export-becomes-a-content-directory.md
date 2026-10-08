---
id: TASK-291
title: 'geekity import wordpress: a WXR export becomes a content directory'
status: To Do
assignee: []
created_date: '2026-10-08 10:59'
updated_date: '2026-10-08 11:55'
labels: []
milestone: m-31
dependencies:
  - TASK-295
  - TASK-282
references:
  - /Users/andrewshell/code/geekity/asdo_geekity/_local/PLAN.md
priority: high
ordinal: 247800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A WordPress site moves to Geekity from its WXR export (Tools > Export) with one command: `geekity import wordpress <export.xml>` writes the posts, pages, media, reactions and redirects into the content directory, so the site answers the same URLs it did under WordPress. Today the only importer is `geekity import wordpress-actor`, which carries the federation identity and none of the content, so every migration hand-writes a converter.

The import is rerunnable: running it again over the same export converges on the same files, so a site can import early, check the result, and import again just before cutover to pick up newer posts. It never overwrites a file it did not write, which lets a site layer its own fixes on top.

The subtasks split it by what is imported. This parent holds the command, the report and the rerun behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 geekity import wordpress <export.xml> runs against a content directory and exits non-zero, with each problem named, when the file is not a WXR export
- [ ] #2 Running the import twice over the same export leaves the content directory byte-identical to one run
- [ ] #3 A file the import did not write is never overwritten or deleted; the clash is listed in the report
- [ ] #4 The import prints a report with one row per item imported, skipped or warned about, and why
- [ ] #5 Items that have no Geekity counterpart (revisions, oembed_cache, nav menus, global styles, ActivityPub plugin internals such as ap_actor/ap_inbox/ap_outbox, contact form feedback) are skipped and counted in the report
- [ ] #6 geekity sync over the imported directory exits 0
- [ ] #7 packages/cms/README.md documents the command next to "Moving a site off the WordPress ActivityPub plugin", as one cutover
- [ ] #8 With TASK-295 dev mode on, an import into a running site with followers makes no outbound request, as the suppression record shows
- [ ] #9 The command and everything WordPress-specific in the subtasks ship in @geekity/plugin-wordpress, not in @geekity/cms (TASK-282 #7: nothing in core names WordPress); a generic piece a subtask needs (for example a redirect rule by path prefix) lands in core as the extension point the plugin uses (decision-33)
- [ ] #10 A rerun against a newer export picks up posts, pages, edits, media and reactions added on WordPress since the last run; a file the import wrote and that has since been edited on Geekity is not overwritten, and the report lists it as a conflict with both versions' dates
<!-- AC:END -->
