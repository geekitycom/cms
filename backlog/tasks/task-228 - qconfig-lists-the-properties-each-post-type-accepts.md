---
id: TASK-228
title: q=config lists the properties each post type accepts
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 01:32'
updated_date: '2026-10-03 13:19'
labels:
  - micropub
  - interop
dependencies: []
references:
  - >-
    backlog/decisions/decision-27 -
    A-Micropub-create-fills-the-editors-form-and-goes-through-the-editors-write-path-and-refuses-what-it-cannot-map.md
  - packages/cms/src/micropub/endpoint.ts
  - packages/cms/src/micropub/post-types.test.ts
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
- [x] #1 Each q=config post-types entry carries 'properties' listing exactly the properties a create of that type accepts, and 'required-properties' where one is required
- [x] #2 A test proves that every listed property is accepted by createForm and that a property createForm refuses is not listed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Name the shape: a table in micropub/create.ts, POST_TYPE_PROPERTIES: Record<PostType, { required, optional }>, typed over a Property union derived from the tables createForm reads (SINGLE_VALUED, ACCEPTED_WITHOUT_EFFECT, the rest), so a name createForm does not map cannot compile into a listing.
2. Rule per type: required = the properties Post Type Discovery needs to call a post that type (repost-of, like-of, in-reply-to, photo, read-of + read-status, bookmark-of; content for a note; name + content for an article). Optional = the properties that never change a post's type (content, summary, category, location, published, post-status, visibility, mp-slug, mp-syndicate-to), plus name on every type but note. Another type's defining property is not listed, since it would change the type. Legacy aliases (slug, syndicate-to) and p3k-content-type are not listed: clients that read the list should send the current names, and Micropublish already shows mp-slug and mp-syndicate-to unconditionally.
3. endpoint.ts q=config: each post-types entry carries properties (required then optional) and required-properties from the table.
4. Tests first (tdd), against the real endpoint: for each q=config post type, a create with every listed property is accepted (201) and Post Type Discovery gives the post that type; a create with only the required properties is too; every property in Micropublish's known list (plus the legacy names) that createForm refuses by name is absent from every listing; q=config shape test updated.
5. Verify: pnpm build, test, typecheck, lint, format:check; curl a running demo's q=config.
6. Decision-27 amendment for the advertised lists; notes, summary.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built POST_TYPES in src/micropub/endpoint.ts (replaces POST_TYPE_NAMES): one record per PostType with name, properties and required. Its names are typed by Property, exported from src/micropub/create.ts as the union of SINGLE_VALUED, ACCEPTED_WITHOUT_EFFECT and the properties mapped on their own (MAPPED_ON_THEIR_OWN), the same lists PROPERTIES is built from, so a name createForm refuses does not compile into a listing.

Rule: required-properties are what Post Type Discovery needs (like-of, repost-of, in-reply-to, photo, bookmark-of, read-of + read-status; content for a note; name + content for an article). properties are those, then the type-neutral ones (content, summary, category, location, published, post-status, visibility, mp-slug, mp-syndicate-to), plus name on every type but note. Another type's defining property is not listed even though createForm accepts it, since it would change the type (a like with in-reply-to is accepted, as a like). I read AC #1's 'accepts' as 'accepts and keeps that type'; the test checks it by Post Type Discovery on the written post.

Not listed: slug and syndicate-to (legacy names for listed properties) and p3k-content-type (changes nothing). Micropublish does not need them: it renders mp-slug and mp-syndicate-to unconditionally (views/form.erb) and never sends the legacy names. Micropublish skips a type it has no defaults for (server.rb post_types), so read is listed for other clients, not for it.

Tests: src/micropub/post-types.test.ts goes through the real endpoint. For each type q=config lists: a create carrying every listed property answers 201 and the post discovers as that type; same with only the required properties. Every property in Micropublish's known list plus the legacy names that a create refuses by name (rsvp, syndication, checkin, mp-channel, listen-of, ate, drank) is absent from every listing. Mutation check: adding photo to note's list fails both the shape and the type test. endpoint.test.ts's shape test now compares type and name only.

Docs: decision-27 amendment (TASK-228), README Queries paragraph.

Validation: pnpm build, pnpm test (3647 + 30 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all pass. Served a scratch site with createCms on port 3917 and fetched GET /_geekity/micropub?q=config with a bearer token over HTTP: 200, every post-types entry carries properties and required-properties as above; server closed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
q=config's post-types entries now carry properties and required-properties per type, from one POST_TYPES record in src/micropub/endpoint.ts whose names are typed by the Property union createForm's own tables define. Required is what Post Type Discovery needs for that type; properties add the type-neutral ones; another type's defining property, the legacy aliases and p3k-content-type are left out. Verified by src/micropub/post-types.test.ts through the real endpoint (every listed property accepted, posts discover as their type, refused properties never listed), the full build/test/typecheck/lint/format run, and an HTTP fetch of q=config from a served site.
<!-- SECTION:FINAL_SUMMARY:END -->
