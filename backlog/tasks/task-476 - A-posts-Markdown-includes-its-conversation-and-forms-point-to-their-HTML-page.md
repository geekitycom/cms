---
id: TASK-476
title: >-
  A post's Markdown includes its conversation, and forms point to their HTML
  page
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-21 23:42'
labels:
  - markdown
  - public-site
  - comments
milestone: m-44
dependencies: []
references:
  - packages/cms/src/web/markdown-representation.ts
  - packages/cms/themes/default/partials/markdown-footer.md.njk
  - packages/cms/themes/default/partials/markdown-header.md.njk
  - docs/theme/markdown.md
  - docs/public-site.md
  - packages/cms/themes/default/partials/conversation.njk
  - packages/cms/themes/default/partials/contact-form.njk
  - packages/cms/themes/default/partials/comment-form.njk
ordinal: 401800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The HTML of a post or page shows its conversation: approved comments, webmentions and fediverse replies threaded, and likes and boosts. Its Markdown has none of it. The contact page's Markdown ends at the prose and gives no way to reach the form, and a post that takes comments says nothing about how to leave one. The Markdown should list the conversation from the same data conversation.njk draws, and say where the contact and comment forms are, linking their HTML page, since a form needs HTML.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post or page's Markdown lists its approved replies (comments, webmentions and fediverse replies) with author, date, link and text, threaded as the HTML threads them
- [ ] #2 Likes and boosts appear as the HTML shows them
- [ ] #3 Nothing the HTML hides (pending, spam, trashed) reaches the Markdown
- [ ] #4 A contact page and a post that takes comments say where their form is and link the HTML page
- [ ] #5 The data is on the Markdown partial context, documented, and tested
<!-- AC:END -->
