---
id: TASK-102
title: >-
  An access log: one line per request, so a served site can be asked what it
  answered
status: To Do
assignee: []
created_date: '2026-09-20 11:35'
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
- [ ] #1 A served request writes one line naming the method, the path, the status and the duration, proven by a test
- [ ] #2 The switch is documented in the README configuration table and works from both the config and the environment, proven by a test for each
- [ ] #3 The default is deliberate and stated in the task notes, with serve and createCms free to differ
- [ ] #4 No client address is logged unless the site asks for one, and the address logged with the switch on is the one GEEKITY_TRUST_PROXY makes right, proven by a test
- [ ] #5 No cookie, credential, password field or request body reaches the log, proven by a test that posts a login and reads the line
- [ ] #6 Every route is covered, including /healthz, the admin and the federation endpoints, proven by a test
- [ ] #7 The Docker README section says where the lines go and how to read them with docker compose logs
<!-- AC:END -->
