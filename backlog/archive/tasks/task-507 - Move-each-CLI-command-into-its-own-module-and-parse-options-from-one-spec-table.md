---
id: TASK-507
title: >-
  Move each CLI command into its own module and parse options from one spec
  table
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24 11:41'
updated_date: '2026-10-24 12:05'
labels:
  - refactor
milestone: m-49
dependencies: []
priority: high
type: chore
ordinal: 418800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/cli.ts is 1970 lines: argument parsing, help text, about 14 command implementations, prompts and formatting. parseArgs repeats the --x / --x= handling per option, and the "needs a value" handling is duplicated at cli.ts:490-496 and cli.ts:1768-1773. The COMMANDS table already gives one entry per command.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each core command implementation lives in its own module under src/cli/ and cli.ts only dispatches
- [x] #2 Value flags are read through one shared helper driven by a table of option specs; the duplicated needs-a-value code is gone
- [x] #3 Command names, flags, help text, error messages and exit codes are unchanged: all cli-*.test.ts suites pass without changes to their assertions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Baseline: build, then run src/cli*.test.ts and the boundary tests (218 green).
2. Add src/cli/options.ts: an OptionSpec table entry type and readOption(), the one helper that reads --name, --name=value and --name value, refuses an unknown option, a value on a switch, and a missing value with the spec's message.
3. Add src/cli/args.ts: core command names, ParsedArgs, CORE_OPTIONS spec table (config, password, email, until, out and the switches), parseArgs built on readOption, plus leadingWords, configFlag, withoutConfig, isHelpOrVersion.
4. Move each core command to its own module under src/cli/ (serve, init, sync, rebuild, resend, maintenance, dev-mode, gemini, settings, strip-metadata, export, import, user, plugin-folder), with shared helpers in small modules (run-job, database-in-use, format, site-plugins, password).
5. src/cli/commands.ts holds the COMMANDS table (synopsis, help, run); src/cli/help.ts the help text; src/cli/plugin-commands.ts plugin command lookup and run, parsing plugin options through readOption.
6. cli.ts keeps main() and the entry-point check: it dispatches only. Heavy modules stay dynamic imports so settings list still loads no CMS core.
7. Boundary tests: add cli/ beside cli.ts in the layer map, settings FORBIDDEN list and the sqlite exception path; cli.test.ts imports parseArgs/readPassword from their new modules.
8. Add tests for readOption. Verify with pnpm build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
cli.ts now holds only main() and the entry-point check. src/cli/ has one module per core command (serve, init, sync, rebuild, resend, maintenance, dev-mode, gemini, settings, strip-metadata, export, import, user, plugin-folder), the COMMANDS table (commands.ts), help text (help.ts), plugin command lookup and run (plugin-commands.ts), argument parsing (args.ts) and shared helpers (options.ts, format.ts, run-job.ts, database-in-use.ts, site-plugins.ts, password.ts).
options.ts: OptionSpec { name, value?: { missing?, dashed?, empty? } } and readOption(), which reads --x, --x=v and --x v and owns every refusal (unknown option, value on a switch, missing value). parseArgs reads CORE_OPTIONS through it; plugin commands map their declared options to specs and go through the same helper, so the duplicated needs-a-value code is gone. --password (dashed + empty allowed) and --email (empty allowed) keep their own messages through spec fields.
Heavy modules stay dynamic imports (index.ts, site-export/import, plugin install), so the TASK-374 startup test still passes. setOrThrow lives in cli/settings.ts and is imported by maintenance, dev-mode and import. totalComments moved into rebuild.ts, its only user.
Boundary tests: layer map now has 'command line' = cli/ and 'command line entry' = cli.ts (cli.ts imports cli/, and same-layer imports are refused, so the two need separate rows; the rules are unchanged). settings FORBIDDEN gains cli/; the sqlite exception moved from cli.ts to cli/database-in-use.ts. cli.test.ts imports parseArgs and readPassword from their new modules; no assertion changed. docs/development.md layout tree and layer table updated.
Added src/cli/options.test.ts (4 tests) for readOption.
Verification: compared old (HEAD cli.ts) and new CLI output and exit codes for 25 invocations (help, version, every error path of the option parser, each command's usage error, maintenance status, settings get, export --list): identical. pnpm build, pnpm test (cms 7481 pass = 7477 + 4 new, all other packages green), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split packages/cms/src/cli.ts (1970 lines) into src/cli/: one module per core command, the COMMANDS table, help text, plugin commands, argument parsing and small shared helpers; cli.ts (about 60 lines) only dispatches. Options are read through one helper, readOption, driven by OptionSpec tables for both core and plugin commands, replacing the per-option --x/--x= code and the duplicated needs-a-value handling. Behaviour unchanged: old and new CLI output and exit codes matched for 25 invocations, all cli-*.test.ts suites pass with no assertion changes, and pnpm build/test (7481)/test:11ty/typecheck/lint/format:check all pass. Boundary test path lists updated for cli/.
<!-- SECTION:FINAL_SUMMARY:END -->
