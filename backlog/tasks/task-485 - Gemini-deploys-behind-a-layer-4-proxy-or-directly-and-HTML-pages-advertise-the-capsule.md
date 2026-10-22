---
id: TASK-485
title: >-
  Gemini deploys behind a layer-4 proxy or directly, and HTML pages advertise
  the capsule
status: To Do
assignee: []
created_date: '2026-10-22 12:07'
labels:
  - gemini
  - ops
  - docs
milestone: m-45
dependencies:
  - TASK-484
references:
  - deploy/compose.yaml
  - Dockerfile
  - docs/deploying.md
  - 'https://github.com/mholt/caddy-l4'
ordinal: 410800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make Gemini deployable on the documented Docker stack (decision-60). An HTTP reverse proxy cannot forward Gemini, but a layer-4 proxy can route port 1965 by SNI with TLS passthrough. Several sites on one host can then share 1965 and each keep its own certificate. The site reads PROXY protocol v2 from a trusted proxy so throttling and logs see the visitor.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 deploy/compose.yaml maps the Gemini port to 127.0.0.1 via GEEKITY_GEMINI_HOST_PORT, and the Dockerfile exposes it
- [ ] #2 With GEEKITY_TRUST_PROXY on, the listener accepts PROXY protocol v1 and v2 headers and uses the client address they carry; without it, a PROXY header is refused
- [ ] #3 docs/deploying.md covers SNI passthrough with caddy-l4, including how to get a Caddy build with the module (xcaddy or a prebuilt image), nginx stream with ssl_preread, and publishing the port directly on a single-site host, with a two-site example
- [ ] #4 With Gemini enabled, HTML pages carry a link rel=alternate to their gemini:// URL, and llms.txt and the Markdown footer mention the capsule where useful
- [ ] #5 docker-smoke.sh checks that the container answers a gemini:// request
<!-- AC:END -->
