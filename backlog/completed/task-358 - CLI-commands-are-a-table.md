---
id: TASK-358
title: CLI commands are a table
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-12 00:37'
labels: []
milestone: m-34
dependencies:
  - TASK-357
type: chore
ordinal: 317800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
cli.ts (1405 lines) dispatches with a chain of if (command === ...) and repeats resolveConfig(await loadConfig(...)) at each command. It also holds config-module loading and the tsx fallback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Commands are declared in one table and usage text is generated from it
- [x] #2 Commands get config through one shared loader
- [x] #3 Config-module loading lives outside cli.ts
- [x] #4 geekity --help and every command behave as before
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pin current behaviour in a new cli-help.test.ts: exact geekity --help (no config, and with a plugin command whose usage and option wrap), and exit code + stderr for an unknown command, an unknown command with --help, and each core command's misuse message.
2. Move loadConfig, the tsx fallback (findSiteTsx, registerTypeScriptLoader) and loadResolvedConfig to packages/cms/src/config-loader.ts; cli.test.ts imports them from there.
3. Replace the COMMANDS list, USAGE literal and the if-chain with one COMMANDS table keyed by command name: each entry has its usage lines, its help entries (name + prose) and run(parsed). Command type, isCommand, usage text and dispatch all derive from it; the Commands section is wrapped by the same wrap() plugin commands use.
4. Each command takes ParsedArgs; every one loads config through loadResolvedConfig.
5. Verify with the pin tests, the full suite, typecheck, lint, format, and the built bin's --help.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pinned first: cli-help.test.ts checks geekity --help byte for byte (no config; -h; after a command; with a plugin command whose usage and option wrap) and the exit code, stdout and stderr of an unknown command (with and without --help), an unknown option, and each core command's misuse message. All 15 passed against the old code before the refactor.
Config loading (CONFIG_FILENAMES, loadConfig, tsx fallback, loadResolvedConfig) moved to packages/cms/src/config-loader.ts; cli.test.ts imports from there.
COMMANDS is a Record<CoreCommand, CommandEntry> table: synopsis lines, help entries (words + lines) and run(parsed: ParsedArgs). Usage, isCommand and dispatch derive from it; the if-chain is gone. The core descriptions are stored as their written lines because the old hand wrapping matches no single greedy width (79 rewraps strip-metadata and plugin upgrade, 78 rewraps rebuild and maintenance), so wrapping them would have changed the help. Core entries and plugin options share helpEntry().
Validation: pnpm build, test (cms 5596 pass), typecheck, lint, format:check all pass. dist/cli.js --help diffs empty against the pre-change output; 19 recorded invocations (help, version, unknown command/option, every misuse) give identical stdout, stderr and exit code.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
cli.ts declares its built-in commands in one COMMANDS table (synopsis, help lines, run(parsed)); usage text and dispatch come from it, every command takes ParsedArgs and loads config through loadResolvedConfig, and config-module loading lives in config-loader.ts. Behaviour is unchanged: new cli-help.test.ts pins the help byte for byte (core and plugin sections) and every misuse message and exit code, passing before and after; full build/test/typecheck/lint/format pass and the built bin's --help matches the old output.
<!-- SECTION:FINAL_SUMMARY:END -->
