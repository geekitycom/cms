---
id: TASK-418
title: >-
  plugin-wordpress turns a Jetpack contact form into contact: true and drops the
  shortcode
status: Done
assignee:
  - '@claude'
created_date: '2026-10-16 03:27'
updated_date: '2026-10-16 12:33'
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
- [x] #1 A page whose body holds a Jetpack [contact-form]...[/contact-form] shortcode imports with contact: true and no trace of the shortcode in its body
- [x] #2 The text around the shortcode is unchanged; a test covers a form at the end of the body, in the middle, and with self-closing and paired contact-field children
- [x] #3 A rerun is idempotent: the second run reports the page unchanged
- [x] #4 Served by geekity serve, an imported page that had a Jetpack form shows its text and Geekity's contact form, with no shortcode text
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. convertBody strips every Jetpack [contact-form ...]...[/contact-form] shortcode (and a self-closed [contact-form /]) before wpautop and reports contact: boolean.
2. documentOf writes extra.contact = true for a page whose body had a form.
3. A post with a form loses the shortcode and gets a warned row, since only pages take contact: true.
4. Tests in test/posts-import.test.ts: form at end, in the middle, self-closing and paired contact-field children, post warning, second run unchanged.
5. Verify with geekity serve on an imported page.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
convertBody strips [contact-form ...]...[/contact-form] and self-closed [contact-form /] before wpautop and returns contact: boolean. A page gets contact: true. A post with a form loses the shortcode and gets a warned row. Contact Form 7 ([contact-form-7]) is deliberately not matched. Gutenberg wp:jetpack/contact-form blocks are out of scope and unchanged. Comments imported through convertBody also lose the shortcode, silently.
Verified end to end. A scratch site with the plugin ran geekity import wordpress on a WXR page holding the task's example form. It wrote contact: true and kept 'Write to me here.' and 'I read every message.' A second run reported the page unchanged. geekity serve then showed both paragraphs and the site's form (POST /_geekity/contact), and no shortcode text. plugin-wordpress tests: 111 pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity import wordpress now removes a Jetpack [contact-form] shortcode from a page and writes contact: true, so the page shows the site's own contact form instead of literal shortcode text. A post with a form gets a warned row. Tests cover a form at the end, in the middle, paired and self-closing fields, classic and block bodies, a post and a rerun. Verified by importing a real WXR through the CLI and serving the page.
<!-- SECTION:FINAL_SUMMARY:END -->
