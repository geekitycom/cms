---
id: TASK-27
title: 'geekity user add: create an admin user from the CLI'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-03 01:28'
updated_date: '2026-09-03 02:34'
labels:
  - infra
  - web
milestone: m-1
dependencies:
  - TASK-9
references:
  - packages/cms/src/cli.ts
type: feature
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Finish the last piece of TASK-25 that was blocked on admin auth. The geekity bin already registers a user command: userCommand in packages/cms/src/cli.ts prints that admin auth has not shipped and exits 1. Replace it with a real geekity user add <username> that creates an admin using the users table and password hashing from TASK-9, so a site can get its first admin without the setup screen (doc-1, decision-6). Read the password from a --password flag or, when absent, from stdin without echo; refuse to create a duplicate username; exit non-zero with a clear message on any failure. Document the command in the packages/cms README CLI table.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 geekity user add <username> creates a user that can log in through /admin/login
- [x] #2 Running it twice with the same username exits non-zero with a clear message and creates no second user
- [x] #3 Password is accepted from --password or read from stdin without echo when the flag is absent
- [x] #4 The packages/cms README CLI table documents the command
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test: parseArgs (the new --password flag), a new exported readPassword(streams) so the no-echo prompt is testable without a pty, the shared credential validator, the geekity bin run as a subprocess against a temporary site (stdout/stderr/exit code/the users table), and the HTTP login through app.request with a user the CLI created.
2. Move the username pattern and MINIMUM_PASSWORD_LENGTH out of src/admin/routes.ts into a new src/admin/credentials.ts with usernameProblem/passwordProblem/credentialProblem, so the setup form and the CLI refuse exactly the same things. routes.ts imports it; src/admin/index.ts re-exports MINIMUM_PASSWORD_LENGTH from the new home, so the public API of src/index.ts does not change.
3. parseArgs learns --password <pw> and --password=<pw>, adding a password field to ParsedArgs alongside configPath. The existing parseArgs tests gain the field.
4. readPassword({ input, output, prompt }): on a TTY, node:readline with a muted Writable so the typed characters are not echoed; off a TTY, one line from stdin so a password can be piped. An empty or absent line is refused.
5. userCommand becomes async: require the add subcommand and a username, validate the username and the password with the shared validator, loadConfig + resolveConfig for dataDir, openAdminStore, createUser, print 'Created admin user <name>.', and close the store in a finally. DuplicateUsernameError, an invalid username and a short password each write a clear message to stderr and return 1.
6. README: replace the 'Not available yet' CLI table row, document --password and the stdin prompt (with the note that a password on argv is visible in ps), and point the admin section's first-admin prose at the command.
7. Verify: pnpm test/typecheck/lint in packages/cms and the root test/typecheck/lint/format:check, plus a manual pass — geekity init into a temp dir, user add, a second run for the duplicate refusal, a piped password, and a curl login through /admin/login against a server on a temp data dir.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decisions

- **One validator, two doors.** The username pattern and `MINIMUM_PASSWORD_LENGTH` moved out of `src/admin/routes.ts` into a new `src/admin/credentials.ts` (`usernameProblem`, `passwordProblem`, `credentialProblem`, `USERNAME_PATTERN`, `MAXIMUM_USERNAME_LENGTH`). The setup form's `setupProblem` now calls `credentialProblem` and only adds the confirmation check, so an account `geekity user add` makes is one the form would have accepted by construction rather than by memory. `MINIMUM_PASSWORD_LENGTH` is re-exported from the new home, so the public API of `src/index.ts` is unchanged; the new names are exported alongside it.

- **`--password` is parsed like `--config`, but takes its value as given.** `ParsedArgs` gained a `password` field. Unlike `--config`, a value starting with a dash is accepted (a password may legitimately start with one) and `--password=` with nothing after it is accepted by the parser and then refused by the password rules, which say why. The help text says a password on the command line is visible in the process list and in shell history.

- **`readPassword` turns raw mode on itself rather than trusting readline.** Two things echo a password on a terminal: the tty driver and readline. Readline's echo goes to a `Writable` that keeps nothing, and the driver's is silenced by raw mode. Readline happens to set raw mode itself, but relying on that would make a password leak the day it changes, so it is set (and restored to whatever it was) here as well. In raw mode Ctrl-C arrives as a byte, so readline's `SIGINT` event is turned into a clear 'Cancelled; no user was created.' and exit 1.

- **Off a terminal, nothing is prompted and the first line is the password.** That is what makes `printf '%s\n' "$PW" | geekity user add ada` work in a script or a test. Input that ends without a line is an error naming both fixes. No confirmation prompt: one prompt keeps the piped case a single line.

- **The store is opened against the resolved config's `dataDir`** — the same file the server reads — and closed in a `finally` on every path, success or failure.

## Validation

- `pnpm test` in `packages/cms`: 348 tests, 0 failures (was 318; 30 new across `src/admin/credentials.test.ts` and `src/cli.test.ts`). `pnpm typecheck`, `pnpm lint`: clean. Root `pnpm lint`, `pnpm typecheck`, `pnpm test` (348 + 10), `pnpm format:check`: all clean.

- Manual pass with the built `packages/cms/dist/cli.js` against a scratch site, then the demo app on port 3000 with `GEEKITY_DATA_DIR` pointed at that scratch data dir, so `apps/demo/data` was never touched (`git status apps/demo` clean afterwards). Port 3000 released.
  - `user add ada --password hunter22`: exit 0, 'Created admin user ada. Sign in at /admin/login.', and the row in SQLite carries `$argon2id$v=19$m=19456,t=2,p=1$…`.
  - Same command again: exit 1, 'A user named "ada" already exists. Pick another name…', still one `ada`.
  - `printf 'correcthorse\n' | user add grace`: exit 0, no prompt printed.
  - Real pty (with the master drained): `user add alan` printed 'Password for alan: ', the typed `topsecret42` never appeared in the terminal output, exit 0. Ctrl-C at the prompt: 'Cancelled; no user was created.', exit 1, nobody created.
  - Refusals, all exit 1 and write nothing: `'bad name'` -> 'A username is 1 to 64 letters…'; `--password short` and `--password=` -> 'A password is at least 8 characters.'; no username -> 'geekity user add <username> needs the name…'; `user remove` -> 'Unknown user subcommand "remove". The only one is: add.'
  - `--config site.config.js` with `dataDir: 'elsewhere'`: the database landed in `elsewhere/geekity.db` and no `data/` was created.
  - curl against the running server: `GET /admin/setup` 302 -> `/admin/login` (setup closed because users exist); `POST /admin/login` as `alan`/`topsecret42` with the form's CSRF token 303 -> `/admin`, and `GET /admin` on that cookie renders 'Signed in as <strong>alan'. The same for `grace`, whose password came off a pipe. A wrong password for `grace` is 401.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the `geekity user add` placeholder with a real command: `geekity user add <username> [--password <pw>] [--config <file>]` opens the site's admin store against the resolved `dataDir`, creates the user with the argon2id hashing TASK-9 landed, prints 'Created admin user <name>. Sign in at /admin/login.' and closes the store on every path.

The username and password rules moved out of `src/admin/routes.ts` into a new `src/admin/credentials.ts`, which both the first-run setup form and the CLI now call, so an account made either way is one the other door would have accepted. `MINIMUM_PASSWORD_LENGTH` keeps its name in the public API; `credentialProblem`, `usernameProblem`, `passwordProblem`, `USERNAME_PATTERN` and `MAXIMUM_USERNAME_LENGTH` join it.

Without `--password` the password is read once from standard input: on a terminal with a prompt and no echo — raw mode is set here rather than left to readline, because that is what stops the tty driver printing it, and Ctrl-C becomes a clear cancellation — and off a terminal with no prompt at all, one line, so it can be piped. A duplicate name, an illegal username, a short password, a missing username and an unknown subcommand each print why and exit 1 without writing anything.

Verified with 30 new node:test tests (the parser, `readPassword` against fake terminals and pipes, and the bin run as a subprocess against temporary sites, including one that logs the new user in through `app.request('/admin/login')`), plus a manual pass with the built `dist/cli.js`: a real pty proving nothing is echoed, the duplicate refusal, a piped password, `--config` redirecting the database, and a curl login through `/admin/login` on the demo server pointed at a scratch data dir (`apps/demo/data` untouched, port 3000 released). `pnpm test` (348), `typecheck` and `lint` in the package and the root `lint`, `typecheck`, `test` and `format:check` all pass. The README CLI table documents the command, with a new 'Creating an admin from the command line' section and a link to it from the admin section.
<!-- SECTION:FINAL_SUMMARY:END -->
