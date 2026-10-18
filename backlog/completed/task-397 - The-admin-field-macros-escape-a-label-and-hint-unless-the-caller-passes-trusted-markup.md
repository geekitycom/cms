---
id: TASK-397
title: >-
  The admin field macros escape a label and hint unless the caller passes
  trusted markup
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 09:07'
updated_date: '2026-10-14 09:56'
labels: []
milestone: m-38
dependencies: []
priority: medium
type: enhancement
ordinal: 353800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The macros in packages/cms/admin/components/fields.njk print label and hint with | safe, so every caller has to escape text it did not write. The generic plugin settings form from TASK-390 (admin/components/setting-fields.njk) escapes a plugin's label and hint before calling them, and that call-site escape is the only thing standing between a plugin's field label and the admin page. A new caller that forgets it is an XSS in the admin. The macros should escape by default, and the admin's own labels that carry markup should say so explicitly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 fields.njk escapes label and hint by default; a caller passes markup only through an explicit, named form (for example a markup-safe value or a separate parameter)
- [x] #2 Every existing admin page renders the same HTML as before for its own labels and hints, shown by the admin page tests and a check of the pages whose labels carry markup
- [x] #3 setting-fields.njk no longer escapes at the call site, and a test renders a plugin field whose label and hint hold <script> and finds them escaped once, not twice
- [x] #4 pnpm lint, typecheck and test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Capture every template render the cms test suite makes (a --require hook on nunjucks Environment.render, outside the repo), twice, to get a baseline and its noise.
2. Failing tests: fields.test.ts renders each macro with a label and hint holding <script> and expects them escaped; markup marked with | safe is kept; a captured hint marked | safe keeps its markup and escapes what it interpolates. plugins.test.ts renders a plugin whose text, url, select, checkbox, secret and env-set fields carry <script> in label and hint and expects them escaped exactly once.
3. fields.njk prints label and hint with autoescape (no | safe). The named route for trusted markup is a markup-safe value: the caller writes | safe on the literal or the {% set %} capture it passes.
4. Mark every admin caller whose label or hint carries markup (or is a {% set %} capture) with | safe.
5. setting-fields.njk drops its | escape; the secret label with its badge is composed in a capture and marked safe, so the plugin label is escaped by autoescape inside it.
6. Re-capture, normalise volatile values, diff against both baselines, and resolve every difference.
7. pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fields.njk prints label and hint with autoescape. The named route for trusted markup is a markup-safe value: the caller writes | safe on a literal or on the {% set %}…{% endset %} capture it passes. Nunjucks captures return plain strings, so every capture passed as a hint needed | safe too, or its markup and already-escaped text would be escaped a second time.
An empty capture marked safe is a SafeString object, which nunjucks treats as truthy, so _below now tests {% if hint | length %} and writes no empty hint paragraph (test added).
Callers changed (54 call sites in 14 pages): every {% set %} capture passed as a hint (settings/general, reading, discussion, email, permalinks, privacy; federation/settings; navigation/menus; users/edit; documents/editor) and comments/all's replyLabel capture; literals carrying <code>, <span> or &rsquo; in documents/editor, documents/syndication, users/apps, users/new. Plain-text literals and data (scope labels, the content-signal hints) go through the escaping route unchanged.
setting-fields.njk: no | escape. Plugin labels go straight in; the secret label with its Set/Not set badge is a capture marked safe, which autoescapes setting.label inside it.
Side effect: users/apps 'Token for ' ~ the token name a user typed is now escaped, where it used to print as markup.
HTML check (AC #2): a --require hook (scratchpad, outside the repo) wrapped nunjucks Environment.render/renderString and saved every render of the whole cms suite. Baseline captured twice on the unchanged tree (6018 renders), after once. Volatile values normalised (CSRF/hex, nonces, temp paths, timestamps, UUIDs, tokens). A render counts as changed only if it differs from both baselines. Result: every page that imports fields.njk is rendered (all 26 pages, 4 to 1177 renders each); no admin page render changed except noise (ports, random ids, digest order) and the two edited test files, whose render multisets were compared with the new tests filtered out: plugins.test.ts 92/92 identical, fields.test.ts 113 identical plus the 2 old markup tests, whose | safe rewrites render byte-identical output. Every marked literal was found rendered as markup in the captures.
Validation: pnpm build, test (cms 5893 pass, plugins 48/31/22/106 pass), typecheck, lint, format:check all exit 0.

Review follow-up: fields.njk splits each macro's label and hint into plain-text label/hint, always escaped (even a value marked safe, via ~ ''), and markup labelHtml/hintHtml, printed as given, like errorHtml. The Html form wins when both are given, and an empty hint or hintHtml writes no paragraph. The macro header states the contract once. Every caller that passed '... | safe' moved to labelHtml=/hintHtml= with no | safe (55 hints, 3 labels: setting-fields' secret label, users/new email, users/apps client_id). comments/all's reply label is plain text now ('Reply to ' ~ row.author) rather than a capture. fields.test.ts covers each macro: a safe-marked label/hint is still escaped, labelHtml/hintHtml keep markup, empty hint writes nothing, a captured hintHtml escapes what it interpolates. The plugin <script> test also checks the secret label keeps its badge through labelHtml. Render check: same recipe as before (--require hook on nunjucks render/renderString, scratchpad only), baseline captured twice on the unchanged HEAD, after once, normalised and compared per test file and template as sets. No admin render changed. The six differing renders are noise: digest order, random SMTP port, PKCE challenge and port, a random password, and a media list caught at another moment on a page that does not use the macros. In fields.test.ts the only render gone is the removed old safe-marked test. plugins.test.ts renders were 44/44 identical. Every page that uses the macros was rendered (26 pages).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The admin field macros (components/fields.njk) now escape label and hint by default; a caller that means markup marks it with | safe on the literal or capture it passes. All admin callers with markup or {% set %} captures were marked (54 call sites, 14 pages), setting-fields.njk dropped its call-site | escape, and an empty safe hint no longer writes an empty paragraph. Verified with new tests (each macro escapes a <script> label and hint; a plugin whose text, url, select, checkbox, secret and env-set fields carry <script> renders them escaped exactly once), a before/after capture of every template render in the cms suite showing no admin page changed, and green build, test, typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
