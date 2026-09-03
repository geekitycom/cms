---
id: TASK-9
title: 'Admin auth: users, sessions, login, first-run setup, CSRF'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-03 02:20'
labels:
  - admin
milestone: m-1
dependencies:
  - TASK-1
  - TASK-3
references:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the auth section of doc-5. Users and sessions tables in SQLite, argon2id password hashing, HttpOnly Secure SameSite=Lax session cookie, CSRF token on mutating forms, login and logout routes, and a first-run setup form when no user exists.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Visiting /admin with no users shows a setup form that creates the first admin and logs them in
- [x] #2 Wrong password on /admin/login returns the form with an error and no session
- [x] #3 Unauthenticated requests to any /admin route other than login and setup redirect to /admin/login
- [x] #4 A POST to an admin form without a valid CSRF token is rejected with 403
- [x] #5 Logout invalidates the session server-side
- [x] #6 Sessions expire after a configurable lifetime
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Seams under test: the Hono app HTTP surface (app.request), the exported admin store API (openAdminStore/createUser/verifyPassword/listUsers/session functions) and resolveConfig for the new session lifetime option. Tests are colocated node:test files under packages/cms/src/admin/.
2. New src/admin/ module, separate from the content store so ContentStore stays about content. openAdminStore({ dataDir }) opens the same geekity.db with node:sqlite DatabaseSync and runs its own migration ledger table (admin_migrations) creating users and sessions.
3. Passwords: node:crypto argon2id (argon2Sync, native in Node 24) with a random 16-byte salt, encoded PHC-style so the parameters travel with the hash. No new dependency. Verify with timingSafeEqual.
4. Sessions: 256-bit random id, per-session CSRF token, created_at/expires_at, cookie geekity_session HttpOnly SameSite=Lax Path=/ and Secure only when config.baseUrl is https (deviation from doc-5, noted). Expired rows are treated as absent and deleted on read.
5. CSRF before login: anonymous session row (user_id NULL) created for GET /admin/login and /admin/setup and carried in the same cookie; its token is the hidden field. On successful login the anonymous row is replaced by a fresh authenticated session id (no fixation).
6. Config: sessionLifetime (seconds) with GEEKITY_SESSION_LIFETIME override, default 14 days. Documented in packages/cms/README.md config table.
7. Templates: packages/cms/admin/ template set with its own Nunjucks environment (site theme cannot shadow it), resolved from import.meta.url like PACKAGED_THEME_DIR so it works from src/ and dist/. login.njk, setup.njk, index.njk placeholder plus a base layout. Added to package.json files.
8. mountAdmin(app) registers GET/POST /admin/setup, GET/POST /admin/login, POST /admin/logout and GET /admin. Guards: no users -> every /admin* redirects to /admin/setup; unauthenticated -> redirect to /admin/login; POST without a valid CSRF token -> 403. createCms opens the admin store, sets c.var.admin, mounts it, and closes it.
9. Export the reusable pieces from src/index.ts for TASK-27 and TASK-15.
10. Verify: pnpm test/typecheck/lint in packages/cms plus the root checks, and a manual curl pass against the demo app on port 3000 covering redirects, Set-Cookie, 403 on missing CSRF and logout invalidation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decisions

- **Auth tables live in a separate module, not the ContentStore.** `src/admin/store.ts` opens its own `DatabaseSync` connection on the same `data/geekity.db` (SQLite WAL is happy with two connections) and keeps its own migration ledger, `admin_migrations`, so its version numbers never collide with the content index's. The reason for the split: the content index is derived and can be deleted and rebuilt at any time, while users and sessions are the one thing in the file that cannot. `createCms` opens both and closes both.

- **Argon2id via `node:crypto`, no dependency.** Node 24 ships `argon2Sync`. Hashes are PHC-encoded (`$argon2id$v=19$m=19456,t=2,p=1$salt$tag`) so the cost parameters travel with each hash and raising them later leaves stored passwords verifiable. `node:crypto` has no `version` parameter (passing one is silently ignored — verified), so the encoder writes v=19 and the parser refuses any other version rather than mis-verifying it.

- **Deviation from doc-5: the cookie is not unconditionally `Secure`.** `Secure` is added when `config.baseUrl` is https. A `Secure` cookie is dropped on a plain-http origin, so a site developed on `http://localhost:3000` could never hold a login (Safari in particular). Every real deployment sets an https baseUrl and therefore still gets `Secure`. `HttpOnly`, `SameSite=Lax` and `Path=/admin` are unconditional.

- **CSRF before login: an anonymous session row.** `GET /admin/login` and `GET /admin/setup` create a session with `user_id NULL` and set the same cookie; its `csrf_token` is the hidden field. No signing key is needed, which keeps the config free of a session secret for now. On a successful login or setup the anonymous row is deleted and a brand new session id is issued, so a planted session id can never become a logged-in one.

- **The guard is middleware on `/admin` and `/admin/*`, not per route.** A path with no handler yet (`/admin/posts`) still redirects an anonymous visitor to the login form instead of falling through to the public site's 404 handler.

- **Admin templates are their own Nunjucks environment** over `packages/cms/admin/`, resolved from `import.meta.url` so it works from `src/` under tsx and from `dist/` when installed. A site's `theme/` cannot shadow the login form. `admin` was added to the package.json `files` array. The three templates are deliberately thin; TASK-10 replaces them.

- **Config:** `sessionLifetime` (seconds, default 14 days), overridden by `GEEKITY_SESSION_LIFETIME`. Documented in the README config table, in a new "The admin" README section, and added to the `geekity init` site template config.

## Validation

All run from a clean tree on branch m2-admin.

- `pnpm test` in `packages/cms`: 318 tests, 63 suites, 0 failures (was 312 before this task's 30 new tests across `src/admin/store.test.ts`, `src/admin/passwords.test.ts`, `src/admin/routes.test.ts` and `src/config.test.ts`).
- `pnpm typecheck` in `packages/cms`: clean.
- `pnpm lint` in `packages/cms`: clean.
- Root `pnpm -r test` (cms + demo), `pnpm typecheck` (build + both projects), `pnpm lint`, `pnpm format:check`: all clean.

Manual pass against `apps/demo` on port 3000 (`npx tsx server.ts`, `GEEKITY_DATA_DIR` pointed at a scratch dir so the demo's own database was left alone), with curl:

- `GET /admin` and `GET /admin/login` with no users: `302` -> `/admin/setup`.
- `GET /admin/setup`: `200` with `set-cookie: geekity_session=<64 hex>; Path=/admin; Expires=...; HttpOnly; SameSite=Lax` and a hidden `csrf_token`.
- `POST /admin/setup` with no token: `403`. With another session's token: `403`. Nobody created either time.
- `POST /admin/setup` with the right token: `303` -> `/admin`, new session cookie, and the pre-login id no longer resolves (`302` -> `/admin/login`).
- `GET /admin` with the new cookie: `200`, "Signed in as <strong>ada".
- `GET /admin/setup` once a user exists: `302` -> `/admin/login`. `GET /admin/posts` anonymous: `302` -> `/admin/login`.
- Wrong password: `401` with "That username and password do not match." and the session still unauthenticated.
- `POST /admin/logout`: `303` -> `/admin/login`, `set-cookie: geekity_session=; Max-Age=0`, and the id is gone from the sessions table.
- `GET /` still `200` and carries no `set-cookie`.
- Stored hash read straight out of SQLite: `$argon2id$v=19$m=19456,t=2,p=1$yndwRTJySpbQq14eiWPhMQ$...`.
- Restarted with `GEEKITY_SESSION_LIFETIME=3`: logged in, `200` immediately, then `302` -> `/admin/login` four seconds later, and the row was pruned (`select count(*) ... = 0`).

Port 3000 was released afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the admin auth layer: a new `src/admin/` module (store, passwords, session, routes, templates) plus a packaged `admin/` template set, mounted on the app by `createCms` so the demo picks it up.

Users and sessions live in their own tables in the site's SQLite file, opened through a second connection with its own migration ledger, so the content index stays purely derived. Passwords are argon2id through `node:crypto` with PHC-encoded costs and no new dependency. A session is 256 random bits in an `HttpOnly; SameSite=Lax; Path=/admin` cookie, `Secure` when `baseUrl` is https (the one deliberate deviation from doc-5, so local http development can log in), lasting the new `sessionLifetime` config option (`GEEKITY_SESSION_LIFETIME`, default 14 days); expired sessions are deleted, not merely ignored. Every mutating admin form carries a per-session CSRF token, including login and setup, which get theirs from an anonymous session created when the form is rendered and thrown away on login to defeat session fixation. One middleware guard covers `/admin` and everything under it.

`openAdminStore`, `mountAdmin`, `guard`, `hashPassword`, `verifyPasswordHash` and the session and path constants are exported from `src/index.ts` for TASK-27 and TASK-15.

Verified with 30 new node:test tests (19 of them HTTP tests through `app.request`) and a manual curl pass against the running demo covering every acceptance criterion: first-run redirects and setup, 403 on a missing or foreign CSRF token, the wrong-password path, the guard, server-side logout invalidation, and expiry under `GEEKITY_SESSION_LIFETIME=3`. `pnpm test` (318 pass), `pnpm typecheck`, `pnpm lint` in the package, and the root `test`, `typecheck`, `lint` and `format:check` all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
