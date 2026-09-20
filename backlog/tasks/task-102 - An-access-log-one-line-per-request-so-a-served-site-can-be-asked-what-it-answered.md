---
id: TASK-102
title: >-
  An access log: one line per request, so a served site can be asked what it
  answered
status: Done
assignee: []
created_date: '2026-09-20 11:35'
updated_date: '2026-09-20 11:54'
labels:
  - web
  - infra
dependencies: []
references:
  - packages/cms/src/cli.ts
  - packages/cms/src/index.ts
  - packages/cms/src/config.ts
  - packages/cms/src/server.ts
  - Dockerfile
  - deploy/compose.yaml
type: feature
ordinal: 127800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Geekity writes nothing about the requests it serves. The whole of its output is two lines at boot — the seed line and 'Geekity is serving …' — and a handful of console.warn calls for failures. A running site cannot be asked whether a request arrived or what it answered.

That gap was found the hard way: somebody could not find @a@shll.me from a Mastodon instance, and the only way to tell whether that instance had ever asked was to look for a WebFinger request in the logs. There was nothing to look at. The reverse proxy's access log has the request line, which is something, but it cannot say why Geekity answered as it did, and a site run without a proxy — which `geekity serve` and the Docker image both support — has nothing at all.

Log one line per request to stdout: the method, the path, the status, and how long it took. stdout because that is what a container collects, what dockge shows and what journald keeps; a site that wants a file redirects it.

Decisions to make rather than guess at, and to write down on the task:
- **On or off by default.** A server that answers the internet should say what it answered, so on for `geekity serve` is the argument; a library embedded in somebody else's app should not write to their stdout uninvited, so off for `createCms` is the argument. They can differ.
- **The client address.** It is the field that makes a log useful for abuse and useless for privacy: an IP address is personal data under the GDPR and a self-hosted blog has no retention policy. Off unless asked for is the safe default, and `GEEKITY_TRUST_PROXY` already decides which address would even be right.
- **The query string**, which carries the WebFinger resource and the search query, and is the part that would have answered the question above. A search query is something a person typed.
- **What not to log**: nothing from a request body, no cookie, no Authorization header, no admin password field.

Keep it one middleware, registered early enough to see every route including /healthz and the federation endpoints, and cheap enough to leave on: no buffering of bodies, no JSON.stringify of anything per request.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A served request writes one line naming the method, the path, the status and the duration, proven by a test
- [x] #2 The switch is documented in the README configuration table and works from both the config and the environment, proven by a test for each
- [x] #3 The default is deliberate and stated in the task notes, with serve and createCms free to differ
- [x] #4 No client address is logged unless the site asks for one, and the address logged with the switch on is the one GEEKITY_TRUST_PROXY makes right, proven by a test
- [x] #5 No cookie, credential, password field or request body reaches the log, proven by a test that posts a login and reads the line
- [x] #6 Every route is covered, including /healthz, the admin and the federation endpoints, proven by a test
- [x] #7 The Docker README section says where the lines go and how to read them with docker compose logs
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New module packages/cms/src/access-log.ts: createAccessLog({ config, write }) returns one Hono middleware. It times the request with performance.now(), and in a finally writes one line: `<method> <path+query> <status> <duration>ms`, with the client address appended only when the site asked for one. Path and query come from slicing c.req.url rather than parsing a URL; nothing else about the request is read, so no body, cookie or header but the forwarded one can reach the line. The address is clientAddress() from admin/throttle.ts, so GEEKITY_TRUST_PROXY decides it once for the whole CMS.
2. Two settings in config.ts, resolved by the same resolveBoolean the other switches use: accessLog (GEEKITY_ACCESS_LOG, default false) and accessLogAddress (GEEKITY_ACCESS_LOG_ADDRESS, default false). A third config-only field, accessLogWriter, is the injectable sink; it defaults to process.stdout.write so a test can read the lines without capturing global stdout.
3. Register it in createCms as the first app.use('*'), before the context middleware, so it covers /healthz, the federation endpoints, the admin and the public site, and still writes a line when a handler throws and the app answers 500.
4. geekity serve turns it on: createCms({ ...config, accessLog: config.accessLog ?? true }), which keeps precedence intact — GEEKITY_ACCESS_LOG still wins over the serve default, and a site that wrote accessLog: false in its config still gets silence.
5. Tests, one at a time, red first, at the seam of a built CMS's app.request/serve: the line's shape for a page; a 404; a WebFinger lookup with its query string; an admin login POST whose line carries neither the password nor the Set-Cookie; /healthz; off by default under createCms; on from the config; on from the environment; no address unless asked for; the X-Forwarded-For address only when trustProxy is on; the socket address on a really served request.
6. README: both rows in the configuration table, a line in the Docker section saying the lines go to stdout and are read with docker compose logs -f.
7. Verify with pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, plus a real geekity serve and curl.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Defaults settled by the maintainer on 2026-09-20, changeable later if they prove wrong:

- On for `geekity serve`, off for `createCms`. A server answering the internet should say what it answered; a library embedded in somebody else's app must not write to their stdout uninvited. createCms must still offer a way to turn it on — an option in the config, not only an environment variable, since a caller building their own server may not want to reach through the environment to do it.
- No client address unless the site asks for one.
- The query string is logged. It is what would have answered the question that prompted this task, and it is what a peer's WebFinger lookup carries.
- Nothing from a body, no cookie, no Authorization header, no password field, ever.

## What was built (2026-09-20)

One Hono middleware in `packages/cms/src/access-log.ts`, registered in `createCms` before anything else is mounted, so it sees /healthz, the federation endpoints, the admin and the public site alike.

**The line.** Four fields, single spaces, fixed order:

```
GET / 200 20.2ms
GET /about/ 200 2.6ms
GET /healthz 200 0.3ms
GET /nothing-here 404 1.1ms
GET /.well-known/webfinger?resource=acct:ada@localhost 404 0.7ms
POST /admin/setup 403 0.4ms
```

Method, path with its query string, status, duration in milliseconds to one decimal. Fixed order so the status is always the third field: `grep webfinger`, `grep ' 500 '` and `awk '$3 >= 500'` all work. With `accessLogAddress` on, the address goes last, after the duration, so turning it on moves nothing else:

```
GET / 200 0.8ms 203.0.113.9
GET /healthz 200 0.3ms ::ffff:127.0.0.1
```

**No timestamp**, deliberately: stdout is collected by Docker, dockge and journald, each of which stamps its own, and the boot lines carry none either. Easy to add later if a site that redirects to a file wants one.

**Cheapness.** No body is read and nothing is buffered. The path and query are sliced out of `c.req.url` by hand rather than through `new URL()`, there is no JSON anywhere, and `performance.now()` twice plus one template literal is the whole per-request cost. When the log is off the middleware is not registered at all, so it costs nothing rather than costing a no-op.

**What can never reach it:** no request body, no cookie, no `Authorization`, no password field. The only header it can see is `X-Forwarded-For`, and only when the site said to believe it. The query string *is* logged, per the settled decision — which does mean a search somebody typed appears in the log; that is the price of the WebFinger lookup being there.

**The status of a request that threw** is logged as 500 rather than as the 200 `c.res` would invent for a request that never got a response.

**Settings** (`config.ts`, the same `resolveBoolean` the other switches use, environment then config then default):

- `accessLog` / `GEEKITY_ACCESS_LOG`, default `false`. `geekity serve` passes `accessLog: config.accessLog ?? true`, so it is on there while `GEEKITY_ACCESS_LOG` still wins and a site that wrote `accessLog: false` still gets silence.
- `accessLogAddress` / `GEEKITY_ACCESS_LOG_ADDRESS", default `false`. The address comes from `clientAddress()` in `admin/throttle.ts` — the same answer the login throttle counts against, so the two can never disagree about who was asking.
- `accessLogWriter`, config only (a sink is a function; no environment variable can carry one). Defaults to `process.stdout.write` with the newline appended, one call per line.

**Files:** new `packages/cms/src/access-log.ts` and `access-log.test.ts`; changed `config.ts`, `index.ts`, `cli.ts`, `config.test.ts`, `cli-serve.test.ts`, `README.md` and `packages/cms/README.md`. Two existing test files were touched: `config.test.ts` gained the three resolution cases, and `cli-serve.test.ts` gained the two `geekity serve` cases plus an `output()` on its local helper (the old `stdout` field is a snapshot taken at boot, and it now waits for `close` rather than `exit` so nothing written is missed).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An access log: one Hono middleware in packages/cms/src/access-log.ts, registered first in createCms so every route is on it, writing one line per request — method, path with its query string, status, duration — to stdout. On for `geekity serve`, off for `createCms`, which turns it on with `accessLog: true` in its config or GEEKITY_ACCESS_LOG in the environment; the client address is off until `accessLogAddress` asks for it, and is then the one GEEKITY_TRUST_PROXY makes right, read through the same clientAddress() the login throttle uses. No body, cookie, Authorization header or password field is ever read.

Verified by nine cases in packages/cms/src/access-log.test.ts (the line's shape, silence by default, the environment door beating the config, the address on and off, the forwarded address believed only behind a proxy, the socket address on a really served request, a login POST whose lines carry neither the password nor the form token nor the session cookie, all four kinds of route at once, and the 500 of a handler that threw), three in config.test.ts, two in cli-serve.test.ts that start a real `geekity serve` and read its stdout, and by curling a real built server: 'GET /.well-known/webfinger?resource=acct:ada@localhost 404 0.7ms', 'GET /nothing-here 404 1.1ms', 'POST /admin/setup 403 0.4ms', and with the address on 'GET / 200 0.8ms 203.0.113.9'. pnpm build, test (2036 + 30 passing), typecheck, lint and format:check all clean. Both READMEs document the two settings in their configuration tables, and the Docker section has a 'Reading the logs' subsection: docker compose logs -f, and grep webfinger for the question that prompted this.
<!-- SECTION:FINAL_SUMMARY:END -->
