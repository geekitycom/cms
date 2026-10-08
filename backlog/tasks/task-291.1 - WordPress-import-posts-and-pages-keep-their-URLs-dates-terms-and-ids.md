---
id: TASK-291.1
title: 'WordPress import: posts and pages keep their URLs, dates, terms and ids'
status: To Do
assignee: []
created_date: '2026-10-08 11:00'
updated_date: '2026-10-08 11:15'
labels: []
milestone: m-31
dependencies:
  - TASK-292
  - TASK-294
  - TASK-296
parent_task_id: TASK-291
priority: high
ordinal: 248800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Each published, draft and scheduled WordPress post or page becomes a Markdown file that Geekity serves at the URL WordPress did, dated the same, filed under the same categories and tags, and federated and syndicated under the same ids. WordPress block markup and classic HTML become Markdown where Markdown can say it, and stay as HTML where it cannot.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post is written to content/posts/YYYY-MM-DD-slug.md and a page to content/pages/slug.md, with an explicit permalink equal to the URL WordPress served (from the export link, not recomputed from the date)
- [ ] #2 date is the UTC instant of post_date_gmt; updated is post_modified_gmt when it differs
- [ ] #3 categories and tags carry the post's WordPress terms by name
- [ ] #4 activitypub.id is set to the object id the WordPress ActivityPub plugin federated (https://<site>/?p=ID), so replies and boosts still resolve
- [ ] #5 A draft or pending post gets draft: true; a future post keeps its date and publishes on schedule; a private or password-protected post is imported as a draft and named in the report
- [ ] #6 A post with the status post format and no title imports with no title, so post type discovery reads it as a note
- [ ] #7 Gutenberg block comments are removed and the body converts to Markdown; HTML Markdown cannot express (iframes, figures with captions, tables with spans) is kept as HTML
- [ ] #8 The site author is matched to an existing Geekity user by login; a post by a login with no Geekity user is named in the report
- [ ] #9 The WordPress page set as the static front page becomes the site.json homepage
- [ ] #10 Tests run against a fixture export that covers each case above
- [ ] #11 When a post's WordPress guid differs from its activitypub.id (on andrewshell.org, posts 813 and 609 and every post carried over from Eleventy), the TASK-292 feed guid key holds the WordPress guid, so no feed reader sees an old post as new
- [ ] #12 YouTube and Vimeo iframes in an imported body become the TASK-294 video form, so no imported post carries provider iframe code
- [ ] #13 Each post records the TASK-296 announce state from WordPress: announced (with the published time WordPress federated it) when activitypub_status is federated, otherwise public-but-never-federated, so importing into a live site announces nothing
<!-- AC:END -->
