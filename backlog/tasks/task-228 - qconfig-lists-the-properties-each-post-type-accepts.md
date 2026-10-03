---
id: TASK-228
title: q=config lists the properties each post type accepts
status: To Do
assignee: []
created_date: '2026-10-03 01:32'
labels:
  - micropub
  - interop
dependencies: []
priority: low
type: feature
ordinal: 243800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Micropublish (TASK-219) shows its own default form fields for each post type unless q=config's post-types entries carry 'properties' and 'required-properties' (lib/micropublish/server.rb post_types in barryf/micropublish). Ours carry only {type, name} (packages/cms/src/micropub/endpoint.ts), so Micropublish offers fields the site refuses. Build each type's list from the same tables createForm maps from (PROPERTIES, SINGLE_VALUED, UNSTORED in packages/cms/src/micropub/create.ts) so the list cannot drift from what is accepted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each q=config post-types entry carries 'properties' listing exactly the properties a create of that type accepts, and 'required-properties' where one is required
- [ ] #2 A test proves that every listed property is accepted by createForm and that a property createForm refuses is not listed
<!-- AC:END -->
