---
id: TASK-418
title: >-
  plugin-wordpress turns a Jetpack contact form into contact: true and drops the
  shortcode
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-16 03:27'
updated_date: '2026-10-16 12:26'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/plugin-wordpress/src/posts-import.ts
  - packages/plugin-wordpress/src/wordpress-html.ts
priority: medium
ordinal: 373800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A WordPress page that uses a Jetpack contact form stores it in post_content as a shortcode, for example [contact-form][contact-field label="Name" type="name" required="true" /][contact-field label="Email" type="email" required="true" /][contact-field label="Website" type="url" /][contact-field label="Message" type="textarea" /][/contact-form]. `geekity import wordpress` has no shortcode handling, so turndown keeps it as a paragraph of literal text with escaped brackets ([contact-form\]). The imported page then prints the shortcode, and it doesn't get Geekity's own contact form unless someone sets contact: true by hand. A page with a Jetpack form is a contact page, so the importer can say so. Proposal: when a post or page body holds a [contact-form]...[/contact-form] shortcode (Jetpack's Grunion syntax, contact-field children, any attributes), remove it and write contact: true in the front matter. A form on a post type that can't take contact: true becomes a warned row.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A page whose body holds a Jetpack [contact-form]...[/contact-form] shortcode imports with contact: true and no trace of the shortcode in its body
- [ ] #2 The text around the shortcode is unchanged; a test covers a form at the end of the body, in the middle, and with self-closing and paired contact-field children
- [ ] #3 A rerun is idempotent: the second run reports the page unchanged
- [ ] #4 Served by geekity serve, an imported page that had a Jetpack form shows its text and Geekity's contact form, with no shortcode text
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. convertBody strips every Jetpack [contact-form ...]...[/contact-form] shortcode (and a self-closed [contact-form /]) before wpautop and reports contact: boolean.
2. documentOf writes extra.contact = true for a page whose body had a form.
3. A post with a form loses the shortcode and gets a warned row, since only pages take contact: true.
4. Tests in test/posts-import.test.ts: form at end, in the middle, self-closing and paired contact-field children, post warning, second run unchanged.
5. Verify with geekity serve on an imported page.
<!-- SECTION:PLAN:END -->
