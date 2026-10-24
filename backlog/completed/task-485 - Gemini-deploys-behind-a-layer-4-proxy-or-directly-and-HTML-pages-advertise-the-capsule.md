---
id: TASK-485
title: >-
  Gemini deploys behind a layer-4 proxy or directly, and HTML pages advertise
  the capsule
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 12:07'
updated_date: '2026-10-23 18:14'
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
- [x] #1 deploy/compose.yaml maps the Gemini port to 127.0.0.1 via GEEKITY_GEMINI_HOST_PORT, and the Dockerfile exposes it
- [x] #2 With GEEKITY_TRUST_PROXY on, the listener accepts PROXY protocol v1 and v2 headers and uses the client address they carry; without it, a PROXY header is refused
- [x] #3 docs/deploying.md covers SNI passthrough with caddy-l4, including how to get a Caddy build with the module (xcaddy or a prebuilt image), nginx stream with ssl_preread, and publishing the port directly on a single-site host, with a two-site example
- [x] #4 With Gemini enabled, HTML pages carry a link rel=alternate to their gemini:// URL, and llms.txt and the Markdown footer mention the capsule where useful
- [x] #5 docker-smoke.sh checks that the container answers a gemini:// request
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. PROXY protocol: a pure reader in web/proxy-protocol.ts that classifies the first bytes of a connection as more-needed, absent (not a PROXY signature, so the client's own TLS bytes), invalid, or a v1/v2 header with its length and client address (undefined for v2 LOCAL, v1 UNKNOWN, AF_UNIX). Bounded: v1 at 107 bytes, v2 at 16 + 2048 bytes.
2. Listener: a net.Server in front of TLS. Each connection reads its preamble with a timeout; a PROXY header is used only with trustProxy and refused (connection destroyed) without it; the leftover bytes are unshifted and the socket is wrapped with new tls.TLSSocket(isServer, secureContext with minVersion TLSv1.2) with a handshake timeout, then answer(tlsSocket, address). With trust on the header is optional: a TLS ClientHello starts with 0x16, which no PROXY signature does, so a client without a header is never misread, and a direct client still works (healthchecks, docker-smoke), as X-Forwarded-For is optional for HTTP. createCms passes resolved.trustProxy.
3. Capsule links: gemini/capsule.ts capsuleUrl(config, site, path) -> gemini://host[:port]path while site.gemini is on, port omitted at 1965. Renderer puts capsuleUrl on documents, listings, search and comment pages (not status pages) and on the Markdown chrome context in Markdown format only (gemtext is converted from the same footer). base.njk prints link rel=alternate type=text/gemini; markdown-footer.md.njk prints a Gemini section; llms.txt says the site is a capsule. Theme docs list capsuleUrl.
4. Deploy: compose maps 127.0.0.1:${GEEKITY_GEMINI_HOST_PORT:-1965}:1965 and fixes GEEKITY_GEMINI_PORT=1965 in the container; Dockerfile EXPOSE 1965; docs/deploying.md Gemini section (caddy-l4 two-site SNI passthrough with proxy_protocol v2, xcaddy / prebuilt image, nginx stream ssl_preread with proxy_protocol, direct publishing on a single-site host); docs/configuration.md if it lists env; docker-smoke.sh turns gemini on and sends a gemini:// request.
5. Tests first for each AC (listener PROXY v1/v2/refusal/timeout/oversize/partial ClientHello; capsule links on and off; smoke), then full pnpm build/test/test:11ty/typecheck/lint/format:check, docker smoke if Docker runs, cli-reload test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision: with GEEKITY_TRUST_PROXY on the PROXY header is optional, as X-Forwarded-For is for HTTP. A TLS record opens with 0x16 and neither PROXY signature does, so readProxyPreamble (web/proxy-protocol.ts) classifies a connection from its first byte; a partial ClientHello is never read as a header. Direct clients (the image healthcheck path, docker-smoke, a single-site host) keep working. Bounds: v1 at 107 bytes, v2 at 16 + 2048 bytes; the preamble read shares requestTimeoutMs (10 s). Invalid, oversized, unfinished, or (trust off) any header closes the connection.
Listener: a net.Server reads the preamble, unshifts the rest, and wraps the socket with new tls.TLSSocket(isServer, secureContext minVersion TLSv1.2) plus a 10 s handshake timer. The cli-reload Gemini test (TLS clients through a reload) still passes, since cluster shares a net.Server the same way.
Capsule links: gemini/capsule.ts capsuleUrl gives gemini://host[:port]path while site.gemini is on, port left out at 1965. The renderer sets capsuleUrl on documents, listings, search and comment pages (not status pages) and on the Markdown chrome only in Markdown format, because the gemtext footer is converted from the same template. compose fixes GEEKITY_GEMINI_PORT=1965 in the container so the advertised URL has no port.
Known trade-off, documented in docs/deploying.md: on a single-site host that publishes 1965 directly, GEEKITY_TRUST_PROXY stays on for HTTP, so a direct client can forge its address for the Gemini throttle and log (not HTTP or sign-in).
Verification: pnpm build, pnpm test (cms 7470 pass, incl. cli-reload Gemini), pnpm test:11ty, typecheck, lint, format:check all pass. scripts/docker-smoke.sh passed for real (gemini:// direct and behind a PROXY v1 header, access log shows 203.0.113.7). Ran two local sites (blog.test, notes.test) behind the documented caddy-l4 Caddyfile (built with xcaddy in Docker, proxy_protocol v2) and the documented nginx stream block (proxy_protocol v1): each site answered 20 by SNI, an unknown SNI was closed, and the access logs showed the proxy-reported address 172.17.0.1 instead of 127.0.0.1. curl of the running site showed the text/gemini alternate link, the Markdown Gemini section and the llms.txt line. docker compose config shows 127.0.0.1:19651->1965 with GEEKITY_GEMINI_HOST_PORT=19651. Images, containers and servers created for the checks were removed or stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gemini now deploys behind a layer-4 proxy or directly, and pages advertise the capsule. The gemini:// listener is a net.Server that reads an optional PROXY v1/v2 header (only with GEEKITY_TRUST_PROXY on; refused otherwise; bounded in size and time) before handing the socket to TLS, so throttling and the access log see the visitor. With Gemini on, HTML pages carry link rel=alternate type=text/gemini, the Markdown footer has a Gemini section, and llms.txt names the capsule. compose publishes 127.0.0.1:${GEEKITY_GEMINI_HOST_PORT:-1965}:1965 and fixes GEEKITY_GEMINI_PORT=1965; the Dockerfile exposes 1965. docs/deploying.md covers caddy-l4 (xcaddy, download page, Docker image build) with a two-site SNI example, nginx stream with ssl_preread, and direct publishing. docker-smoke.sh checks gemini:// directly and behind a PROXY header. Verified by unit and listener tests, full test suites, a real docker smoke run, and live runs through the documented caddy-l4 and nginx configs.
<!-- SECTION:FINAL_SUMMARY:END -->
