---
id: TASK-285
title: >-
  @geekity/plugin-post-summary: editor actions that suggest a title and
  description
status: Done
assignee:
  - '@claude'
created_date: '2026-10-06 12:09'
updated_date: '2026-10-08 16:00'
labels:
  - plugins
  - llm
  - admin
milestone: m-30
dependencies:
  - TASK-284
references:
  - >-
    backlog/decisions/decision-33 -
    Plugins-are-named-modules-with-declared-dependencies-loaded-at-boot-and-enabled-per-site-at-runtime-core-grows-each-extension-point-only-alongside-a-plugin-that-uses-it.md
  - packages/cms/admin/pages/documents/editor.njk
  - packages/cms/src/admin/preview.ts
  - packages/cms/src/admin/headers.ts
priority: medium
type: feature
ordinal: 241800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
M31 (decision-33). Core gains editor actions: a plugin contributes a button beside an editor field (title, description, tags), a JSON endpoint under /admin/plugins/<package name>/ behind the admin guard and CSRF, and a static script served from the plugin under the admin CSP (script-src self, connect-src self). First user: a new package, packages/plugin-post-summary (@geekity/plugin-post-summary), that requires @geekity/plugin-llm. On a click it sends the draft title, body and kind to the server, which asks llm for a title and a description with a schema, and the editor shows the suggestions to accept or dismiss. Nothing is sent on save or publish. Each plugin package added here gets its release-please entry (include-component-in-tag true), its commitlint scope and CLAUDE.md scope row, CI lint, typecheck and tests, the shared bundle build, and a smoke test installing it against the packed @geekity/cms tarball.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An enabled plugin can add a button beside the title, description or tags field; a disabled plugin adds nothing and its endpoint answers 404
- [x] #2 Plugin endpoints require a signed-in user and a valid CSRF token; plugin scripts load from the admin origin with no CSP change
- [x] #3 Suggest title and Suggest description each show a suggestion the author accepts into the field or dismisses; accepting never saves the post
- [x] #4 Untitled kinds (note, like, reply, photo) are not offered a title suggestion; the description suggestion respects the length the theme and feeds use
- [x] #5 Every llm error is shown in plain words beside the button and the editor stays usable; with llm unconfigured the buttons explain how to configure it
- [x] #6 The editor works unchanged with JavaScript off and with the plugin disabled
- [x] #7 Verified in a real browser against a fake llm server: click, see the suggestion, accept it, save
- [x] #8 The package has its release-please entry, commitlint scope, CLAUDE.md scope row, CI jobs, bundle build and packed-tarball smoke test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape first. Core (plugin.ts) gains PluginEditorField ('title' | 'description' | 'tags'), PluginEditorDraft (type, postType by Post Type Discovery, saved, title, body, description, tags, lang), PluginEditorAction ({ id, field, label, offers?(draft), suggest({ draft, signal }) }) and PluginEditorSuggestion ({ ok: true, value } | { ok: false, message }). host.editorAction(action) declares one during register.

1. Registry: host.editorAction validates the id (lower case words joined by -, unique per plugin) and records it in PluginContributions.editorActions; host-keys test grows 'editorAction'.
2. Draft: extract submittedForm(kind, body) from saveFromForm so the editor's save and the action endpoint read the form the same way; editorDraft(form, kind, site language) builds the draft, the post type from discoverPostType over the form's properties.
3. Endpoint: POST /admin/plugins/<package name>/editor/<id>, inside the admin guard (signed in, CSRF token in the form body). It answers JSON { ok, value } or { ok: false, message }, 404 when the plugin is not active or has no such action (falls through as if absent), and refuses an action whose offers() is false for the draft with withdrawn: true. Registered before the plugin screen routes, which match /admin/plugins/*.
4. Editor: a macro draws, beside the title, description and tags fields, each active plugin's action as a hidden button, a status line and a hidden suggestion with Accept and Dismiss. Nothing is drawn, and no script loaded, when no active plugin has an action, so a disabled plugin leaves the HTML unchanged. One core script, admin/static/editor-actions.js (same origin, no CSP change), unhides the buttons, posts the editor form to the endpoint, shows the suggestion or the plain-words error, and Accept writes the field (tags merge without duplicates) and fires input so the slug follows; nothing is saved.
   Decision: core draws the button, the suggestion and the script, rather than each plugin shipping a browser script, because admin.css is compiled from core's sources alone (Tailwind source(none)), so a plugin's own markup could not be styled, and neither known consumer needs client code of its own (decision-33: no host API without a consumer).
5. packages/plugin-post-summary (@geekity/plugin-post-summary): requires @geekity/plugin-llm; Suggest title (not offered for like, reply, repost, rsvp, photo, or a saved note) and Suggest description (one or two sentences within the 280 characters the default theme's listings print and the 55 words of a feed excerpt), each one llm complete call with a strict schema, every LlmFailure kind in plain words, unconfigured pointing at Plugins > LLM.
6. Package wiring: package.json with geekity field and peer deps, tsconfigs, README, LICENSE, version.ts, bundle build + bundle test, release-please config and manifest, commitlint scope plugin-post-summary and the CLAUDE.md row, pack-install smoke coverage.
7. Docs: doc-1 Plugins (editor actions), doc-5 Editor and Plugins, core README plugin section if it lists host methods.
8. Verify: pnpm build, test, typecheck, lint, format:check, scripts/pack-install-smoke.sh, and Playwright Chromium against a scratch site with a fake llm server: click, see, accept, save; JS off; plugin disabled.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Core: plugin.ts gains PluginEditorField, PluginPostType, PluginEditorDraft, PluginEditorContext, PluginEditorSuggestion, PluginEditorAction and host.editorAction (HOST_API_VERSION stays 1). registry.ts records editorActions (id: lower case words joined by -, unique per plugin; a bad id fails register). documents.ts: submittedForm() extracted from saveFromForm so the save and the action endpoint read the form one way. src/admin/editor-actions.ts: editorActionViews (buttons for running plugins whose offers(draft) is true) and mountEditorActions, POST /admin/plugins/<name>/editor/<id>, registered before the plugin screens' /admin/plugins/*; not running or unknown id falls through to 404; offers false on a press answers { ok: false, withdrawn: true, message }; a throw answers 500 with '<label> failed: ...'. The draft's postType is discoverPostType over the form (rendered body text, citations, photos, rsvp, event start, read).
Deviation from the task text: there are no plugin-shipped browser scripts. Core draws the button and the suggestion and one core script, admin/static/editor-actions.js, drives every action. Reason: admin.css is compiled by Tailwind with source(none) from core's templates only, so a plugin's own markup could not be styled, and neither post-summary nor tag-suggest (TASK-286) needs client code; decision-33 says no host API without a consumer. AC#2's 'plugin scripts load from the admin origin with no CSP change' is met in that the only script is same-origin under the unchanged policy. TASK-286 may need the suggestion to carry several choices with a note each (follower counts); that is core growth for that task.
Untitled kinds: Suggest title is not offered for like, reply, repost, rsvp, photo, or a saved untitled note; a new untitled post is offered (a title makes it an article). Suggest description is not offered for a read post (the editor says to leave a read's description empty). Description cut to 280 characters (default theme listings, truncate(280)) and 55 words (feed excerpt).
plugin-post-summary: requires/geekity.requires '@geekity/plugin-llm': '^0.1.0' (the first release), peer dependency 'workspace:^' like the cms peer, because a peer of ^0.1.0 would not install against the unreleased 0.0.0 tarball in the smoke test. A package test holds requires == geekity.requires and the peer present.
Validation: pnpm build, pnpm test (cms 4891, demo 32, plugin-llm 37, plugin-post-summary 14, plugin-wordpress 36, all pass), pnpm -r typecheck, pnpm lint, prettier --check all clean; scripts/pack-install-smoke.sh passed (packs and installs post-summary, loads its bundle alone, finds both buttons on /admin/posts/new and gets the unconfigured message from the endpoint). Browser: Playwright Chromium against a scratch site on :4385 with a fake chat-completions server: Suggest title shows the suggestion, Accept fills Title and the slug follows, nothing on disk until Publish, Suggest description likewise, Publish writes both; Dismiss leaves the field; a 401 shows 'The language model provider refused the API key...' in text-error and Update still saves; adding like-of withdraws Suggest title; no CSP violations or page errors; JavaScript off shows no buttons and saves; plugin disabled draws no blocks and no script and saves. Server stopped.
Not run here: the deslop and no-comments passes the repo memory asks for before a PR; the orchestrator owns the PR.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Core gains editor actions: host.editorAction puts a button beside the title, description or tags field while the plugin runs; core draws it with the suggestion's Accept and Dismiss and drives it from one same-origin script under the unchanged admin CSP; the press posts the form to /admin/plugins/<name>/editor/<id> inside the admin guard (session and CSRF), which hands the plugin a typed draft (kind by Post Type Discovery, saved, title, body, description, tags, language) and answers JSON. Disabled plugins draw nothing and their endpoints 404; with JavaScript off the form is unchanged. New package @geekity/plugin-post-summary requires @geekity/plugin-llm and offers Suggest title (not for likes, replies, reposts, RSVPs, photos or saved notes) and Suggest description (within 280 characters and 55 words), each one schema-checked llm call, every failure kind in plain words. Wired into release-please, commitlint, CLAUDE.md, CI and the pack-install smoke. Verified by core and package tests, full build/test/typecheck/lint/format, the smoke script, and Playwright Chromium against a fake llm server (click, see, accept, save; errors; JS off; disabled).
<!-- SECTION:FINAL_SUMMARY:END -->
