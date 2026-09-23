---
id: TASK-100
title: Settings > Email shows the credential fields of the provider that is chosen
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 10:38'
updated_date: '2026-09-20 10:45'
labels:
  - admin
  - web
dependencies: []
references:
  - packages/cms/admin/pages/settings/email.njk
  - packages/cms/src/admin/settings-email.ts
  - packages/cms/src/admin/mail.test.ts
  - packages/cms/admin/components/fields.njk
type: feature
ordinal: 125800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Mail credentials panel draws both providers at once: a Brevo API key box and five SMTP boxes, whichever provider the Provider select at the top of the page names. A site sending through Brevo is shown an SMTP host, port, TLS switch, username and password it will never use, and a site sending through SMTP is asked for an API key it will never use. Six of the seven boxes on that panel are noise on any given site.

Draw the part that matches the saved provider, and nothing else:
- Brevo chosen: the API key, and what is stored for it.
- SMTP chosen: host, port, the TLS switch, username and password.
- None chosen: neither, just the state line saying the site sends nothing.

The provider is read from what is saved, not from what the select currently shows, because the select belongs to the settings form above and the credentials are their own form: nothing has changed until Save settings is pressed. The panel should say so where it would otherwise look broken — somebody who picks SMTP and looks straight down for a host box needs to be told to save first. Do not add JavaScript for this; every other admin screen works without it.

Two things must not be hidden along with the fields:
- A credential stored for the other provider. A site that used SMTP and moved to Brevo still has an SMTP password in data/mail.json, and the panel is the only place that says so. Keep the Remove credentials button reachable whenever anything is stored, and say what is stored even when its provider is not the chosen one.
- The paragraph about where credentials are kept and that a blank box keeps the stored secret.

Send a test message belongs with a site that can send: draw it only where the provider is configured, the way the user notices panel is drawn only where there is a provider and an address (TASK-97).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With Brevo chosen, the panel offers the API key and no SMTP box, proven by a test
- [x] #2 With SMTP chosen, the panel offers host, port, the TLS switch, username and password, and no API key box, proven by a test
- [x] #3 With no provider chosen, the panel offers no credential box and says the site sends nothing, proven by a test
- [x] #4 A credential stored for a provider that is not the chosen one is still reported, and Remove credentials still reaches it, proven by a test
- [x] #5 The panel says that the provider is the saved one and that a change to the select takes a Save settings first
- [x] #6 Send a test message is drawn only where the site can actually send, proven by a test
- [x] #7 No JavaScript is added, and the existing mail tests pass with their assertions unchanged except where a test asserted a box that is now deliberately hidden
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the screen as it stands: packages/cms/admin/pages/settings/email.njk, the panel data in mailPanel() in packages/cms/src/admin/settings-email.ts, the field macros in packages/cms/admin/components/fields.njk, and the existing tests in packages/cms/src/admin/mail.test.ts.
2. Add a failing test per acceptance criterion to mail.test.ts, in a new describe over what the panel draws, using the file's own admin()/writeMailCredentials harness and a GET of the settings screen. Assert on the field names the boxes carry (MAIL_FIELDS.*), not on prose that will be reworded.
3. Rewrite the Mail credentials panel in email.njk so the credential form draws only the chosen provider's boxes: Brevo the API key, SMTP host/port/TLS/username/password, none neither and no form at all. No JavaScript; the branch is on mailProvider, which mailPanel() already reads from the saved settings.
4. Keep the panel's heading and its state line in every case, and add one hint saying the boxes follow the saved provider and that a change to the Provider select takes Save settings first.
5. Report a credential stored for a provider that is not the chosen one as a static line - the Brevo key's last four, the SMTP host and user - so nothing silently keeps a stored secret out of sight, and keep the Remove credentials form wherever anything is stored.
6. Draw the Send a test message form only where mailConfigured is true, the way users/edit.njk draws the notice panel only where there is a provider and an address.
7. Keep the paragraph about data/mail.json and the blank-keeps-the-secret rule outside every branch.
8. Verify with pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, then check the acceptance criteria and write the notes and summary.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Template-only behaviour change: mailPanel() in src/admin/settings-email.ts already handed the page everything needed — mailProvider (the saved one, from site.json), mailConfigured, mailBrevoPresent/mailSmtpPresent and the non-secret halves of each credential — so nothing on the server side moved and no new context key was invented.

admin/pages/settings/email.njk now branches the Mail credentials panel on mailProvider:
- 'brevo' draws an API key and the 'a key is stored, ending …' line; 'smtp' draws host, port, the TLS switch, username and password; 'none' draws no credential form at all. All through the field macros in components/fields.njk, unchanged.
- Every state carries a paragraph saying the boxes follow the provider that is *saved*, not the select above, and that a change there takes a Save settings first. On 'none' that paragraph is what stands in for the form, keeping the panel's heading and explaining the emptiness rather than letting it vanish (the users/edit.njk pattern from TASK-97).
- A credential stored for a provider that is not the chosen one gets an 'Also stored' block: the Brevo key's last four, or the SMTP user, host, port and whether there is a password, as static text. It is the only place in the admin that says what is on disk, so hiding it with the boxes would have been the screen lying. The Remove credentials form is still drawn whenever anything is stored at all.
- Send a test message is drawn only where mailConfigured is true — a provider chosen and its credential stored.
- The paragraph about data/mail.json, 0600 and a blank box keeping the stored secret sits outside every branch.

No JavaScript: the only match for /script/ in the template is the comment saying why there is none.

Not one existing assertion changed: git diff --numstat on src/admin/mail.test.ts is 149 added, 0 removed. 'never prints a stored secret back into the page' still asserts smtp.example.com and postmaster appear on a Brevo screen, and it passes because the leftover SMTP server is now reported in words instead of in boxes — which is exactly what AC #4 asked for.

Docs kept true: the Email section of packages/cms/README.md gained a paragraph on what the panel draws and a note that Send test email appears only where the site can send; doc-5 Admin UI got the same two facts in its Email bullet, through 'backlog doc update'.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The Mail credentials panel on /admin/settings/email now draws one provider's boxes instead of seven: the API key where Brevo is the saved provider, host, port, the TLS switch, username and password where SMTP is, and no credential form at all where neither is. The branch is on the provider in site.json, not on what the Provider select is showing, and every state says so — picking a provider and looking down for its boxes tells you to press Save settings first. No JavaScript; the change is entirely in admin/pages/settings/email.njk, through the field macros in components/fields.njk.

Two things deliberately survive the hiding. A credential stored for the provider that is not chosen is reported in words under 'Also stored' — the key's last four, or the SMTP user, host and port — because this panel is the only screen that says what is in data/mail.json, and Remove credentials is drawn wherever anything is stored. The paragraph about where secrets live and that a blank box keeps the stored one sits outside every branch. Send a test message is now drawn only where the site can actually send, the way TASK-97 draws the notice switches only where there is a provider and an address.

Verified with nine new tests in packages/cms/src/admin/mail.test.ts, at the file's existing seam — a signed-in GET of the settings screen — asserting on the field names the boxes submit rather than on prose, with the AC #5 assertion scoped to the panel so the settings form's own 'Save settings' cannot satisfy it. Every pre-existing assertion in that file is untouched (git diff --numstat: 149 added, 0 removed); 'never prints a stored secret back into the page' passes unchanged because the leftover SMTP server is now reported in words. Full run: pnpm build, pnpm test (2017 pass / 0 fail in the package, 30 / 0 in the demo), pnpm typecheck, pnpm lint and pnpm format:check all clean. The four states were also rendered and read through a throwaway script, since deleted. README and doc-5 updated to match.
<!-- SECTION:FINAL_SUMMARY:END -->
