---
id: TASK-88
title: 'Seed an empty content directory with the starter site on serve, when asked to'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-19 15:24'
updated_date: '2026-09-19 20:56'
labels:
  - content
  - infra
milestone: m-15
dependencies: []
references:
  - packages/cms/src/init.ts
  - packages/cms/src/cli.ts
  - packages/cms/templates/site
type: feature
ordinal: 113800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Docker image mounts content/ from the host, and on a new box that volume is empty. Rather than boot a site with no site.json and nothing to show, the image should start from the same starter site `geekity init` writes (templates/site/content: site.json, a hello-world post, an about page, the collection data files), after which the first-run setup screen creates the admin. Make this a behaviour of `geekity serve`, switched on by an environment variable (for example GEEKITY_SEED_CONTENT=true) or a config option, so the image can turn it on while a site run from npm keeps today’s behaviour of never writing content it was not asked to. A directory counts as empty when it is missing or has no entries at all; anything else, even a lone dotfile, is left untouched, so a mounted site is never overwritten. The seeded site.json takes its url from the resolved base URL so the settings screen shows the real address. Seeding reuses the code `geekity init` already copies with rather than a second copy of the template. It logs one line saying it seeded.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With seeding on and a missing or empty content directory, serve writes the starter content and then boots, proven by a test
- [x] #2 With seeding on and a content directory that has any entry, nothing is written or changed, proven by a test
- [x] #3 With seeding off, which is the default, serve writes nothing to an empty content directory
- [x] #4 The seeded site.json url is the resolved base URL
- [x] #5 Seeding and `geekity init` share one copy routine and one template
- [x] #6 The README documents the switch in the configuration table
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Seams under test: seedStarterContent() in init.ts, resolveConfig() in config.ts, and the geekity serve command run as a child process.

1. config.ts: add seedContent (boolean, default false) to GeekityConfig and ResolvedConfig, overridden by GEEKITY_SEED_CONTENT through the existing resolveBoolean.
2. init.ts: pull the template copy into one routine, copyTemplate(part, destination), that initSite uses for the whole site and seeding uses for templates/site/content. Share isEmptyOrMissing.
3. init.ts: seedStarterContent({ contentDir, baseUrl }) copies the starter content only when contentDir is missing or has no entries at all, rewrites site.json's url to the base URL, and returns whether it seeded.
4. cli.ts serveCommand: resolve the config, and when seedContent is on, seed before createCms, then log one line.
5. Tests: unit tests for seeding (missing, empty, a lone dotfile, site.json url, same files as init); config tests for the switch; cli-serve.test.ts spawns geekity serve on port 0 with seeding on and off and curls /healthz.
6. README: add seedContent / GEEKITY_SEED_CONTENT to the configuration table.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Switch: seedContent in geekity.config.ts, overridden by GEEKITY_SEED_CONTENT (resolveBoolean, so true/1/yes/on and false/0/no/off; anything else throws at boot). Default false.

Seeding runs in the CLI's serveCommand, before createCms, not inside createCms/cms.serve(). A site that builds its own server from server.ts therefore never has content written for it, and createCms sees a complete site.json on its first read. The url written is resolveConfig's baseUrl (environment, then config, then http://localhost:<port>). No site.json exists yet at that point, so that is the effective base URL.

init.ts now has one private copyTemplate(part, destination). initSite copies '.' through it and seedStarterContent copies 'content' through it. Both use the same SITE_TEMPLATE_DIR and the same isEmptyOrMissing check, which counts a directory as empty only when readdir returns no entries.

Log line: 'Seeded <contentDir> with the starter site', printed only when seeding happened.

Tests: src/seed.test.ts (missing dir, empty dir, the url, a lone dotfile untouched, an existing site untouched, byte-identical to init's content apart from the url), src/config.test.ts (default off, config on, env on, env off overrides config, bad value throws), and src/cli-serve.test.ts. That last file spawns geekity serve on port 0 and covers seeding then answering 200 on /healthz and /about/, an empty dir, a dir holding a dotfile left alone, and seeding off leaving an empty dir empty.

Validation: pnpm build, pnpm test (1924 + 30 pass), pnpm typecheck, pnpm lint and pnpm format:check all clean. A manual run of dist/cli.js serve with GEEKITY_SEED_CONTENT=true printed the seed line, and curl returned healthz 200, home 200 and /admin 302 to /admin/setup. site.json had url http://seed.test. A second boot on the same directory did not seed again. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity serve can now seed a missing or empty content directory with the starter site. The switch is seedContent / GEEKITY_SEED_CONTENT and is off by default. Seeding copies templates/site/content through the same copyTemplate routine and the same template that geekity init uses, and sets the seeded site.json url to the resolved base URL. A directory with any entry, even a dotfile, is left alone. It logs one line when it seeds. The README configuration table documents the switch. Verified with new unit, config and spawned-serve tests (full suite green), build/typecheck/lint/format clean, and a manual curl of a seeded site (healthz 200, home 200, admin redirects to setup).
<!-- SECTION:FINAL_SUMMARY:END -->
