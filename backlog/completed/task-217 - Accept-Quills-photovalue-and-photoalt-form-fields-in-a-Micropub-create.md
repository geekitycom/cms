---
id: TASK-217
title: 'Accept Quill''s photo[value] and photo[alt] form fields in a Micropub create'
status: Done
assignee: []
created_date: '2026-10-02 17:16'
updated_date: '2026-10-02 19:38'
labels:
  - micropub
  - accessibility
milestone: m-25
dependencies: []
priority: medium
type: enhancement
ordinal: 233800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Quill sends a photo with alt text form-encoded as photo[value] and photo[alt], a client convention outside the Micropub spec. The endpoint refuses it with 400 'does not understand photo[value], photo[alt]' (decision-27 refuses what it cannot map). Without alt text Quill's photo post works, but a site with requireAltText on cannot take a Quill photo at all, and alt text is the point of M22. Found by reading Quill's source and reproduced with curl while building TASK-170. Decide whether to accept the form convention and map it onto the existing {value, alt} photo shape from TASK-166.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A form-encoded create with photo[value] and photo[alt] stores the photo with its alt text
- [ ] #2 decision-27's mapping notes record the accepted convention
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-02: not needed against a Geekity site. Read from Quill's source (views/new-post.php, aaronpk/Quill 691cee2):
- When the site advertises a media endpoint (every Geekity site does, TASK-165), Quill uploads a chosen file to it at once (new-post.php:431, as field 'file' with the token in the header only), so every photo becomes a URL ('external').
- A photo URL with alt text makes Quill send the post as JSON (new-post.php:865) with photo: [{value, alt}], which TASK-166 already accepts, mapping the site's own upload URL back to /uploads and keeping the alt.
- The photo[value] / photo[alt] form fields are only sent in the multipart path, used when a site has no media endpoint and the raw file travels with the post.
The TASK-170 pre-flight reproduced the refusal of the form fields with curl but did not check when Quill sends them.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed without code: Quill sends a photo with alt text as JSON photo: [{value, alt}] to a site with a media endpoint, which TASK-166 accepts. The photo[value]/photo[alt] form fields are used only for sites without a media endpoint, which a Geekity site never is.
<!-- SECTION:FINAL_SUMMARY:END -->
