---
id: TASK-150
title: BreadcrumbList JSON-LD and visible breadcrumbs in the default theme
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - seo
  - theme
milestone: m-22
dependencies: []
references:
  - 'https://specification.website/spec/seo/breadcrumbs/'
  - 'https://specification.website/spec/seo/structured-data/'
priority: low
type: enhancement
ordinal: 174800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The theme emits WebSite, Person, ProfilePage and BlogPosting JSON-LD (partials/jsonld.njk), but no BreadcrumbList. Posts in a category and archive pages have a natural hierarchy that search results can show.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Posts with a category, category and tag archives, and author archives emit BreadcrumbList JSON-LD
- [ ] #2 The default theme shows a matching visible breadcrumb in a labelled nav
- [ ] #3 The JSON-LD validates with the schema.org validator
<!-- AC:END -->
