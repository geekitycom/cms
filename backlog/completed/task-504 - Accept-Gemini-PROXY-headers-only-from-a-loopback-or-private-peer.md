---
id: TASK-504
title: Accept Gemini PROXY headers only from a loopback or private peer
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 18:17'
updated_date: '2026-10-23 18:23'
labels:
  - security
milestone: m-45
dependencies:
  - TASK-485
priority: high
ordinal: 416800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-485 lets the Gemini listener read an optional PROXY v1/v2 header whenever GEEKITY_TRUST_PROXY is on. GEEKITY_TRUST_PROXY must stay on for HTTP behind the reverse proxy, so on a host that publishes the Gemini port directly any client can send a PROXY header with a made-up address and get around the per-address Gemini request limit and the access log. Only the layer-4 proxy should be able to set the client address. The documented deployments reach the listener from a loopback or private address (caddy-l4 or nginx on the same host through the Docker bridge), while a direct visitor comes from a public address, so the peer address alone tells them apart without a new setting. See decision-60.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With GEEKITY_TRUST_PROXY on, a PROXY header from a loopback (127.0.0.0/8, ::1), private (10/8, 172.16/12, 192.168/16, fc00::/7) or link-local peer, including IPv4-mapped IPv6 forms, sets the client address as before
- [x] #2 With GEEKITY_TRUST_PROXY on, a PROXY header from any other peer closes the connection, the same as a header with trust off; a TLS handshake from that peer is served normally
- [x] #3 Tests drive the listener with a PROXY header from a private and from a public peer address and assert the address that reaches the throttle and the log
- [x] #4 docs/deploying.md and docs/configuration.md say which peers may send a PROXY header and that a proxy on another public host is not trusted
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reuse util/public-address.ts: split its ranges into local (loopback, private, link-local) and reserved, keep isPrivateAddress for SSRF as local+reserved, export isLocalAddress (IPv4-mapped forms unwrapped; a non-IP or missing address is not local).
2. Gemini listener: trustProxy becomes a predicate over the TCP peer address (socket.remoteAddress); a PROXY header from a peer it refuses closes the connection, as with trust off. A TLS handshake is served regardless.
3. create.ts passes isLocalAddress when GEEKITY_TRUST_PROXY is on and a never-trust predicate when off.
4. Tests first: isLocalAddress unit test (private, mapped, public, mapped public); listener tests from a loopback peer through isLocalAddress (header address reaches throttle and log, predicate saw the TCP peer) and from a peer the predicate calls public (closed, nothing logged, TLS served with socket address).
5. Docs: deploying.md Serving Gemini and configuration.md name the trusted peers and say a proxy on another public host is not trusted.
6. Run docker-smoke.sh if Docker is available.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reused util/public-address.ts rather than a new helper. Its ranges are now two lists: LOCAL (loopback, private, link-local) and RESERVED (0/8, 100.64/10, 192.0.0/24, 198.18/15, multicast, 240/4, ::, ff00::/8). isPrivateAddress (SSRF guard) checks both and still treats a non-IP as private; the new isLocalAddress checks LOCAL only and treats a non-IP as not local, so CGNAT 100.64/10 peers are not trusted.
Seam: GeminiListenerOptions.trustProxy is now a predicate over the TCP peer (socket.remoteAddress) instead of a boolean; create.ts passes isLocalAddress when GEEKITY_TRUST_PROXY is on and () => false when off. A missing remoteAddress is not trusted. No test-only branch: the public-peer test passes a predicate that runs isLocalAddress on 198.51.100.20 in place of the loopback peer.
Validation: pnpm build, pnpm test (cms 7474 tests, 0 fail), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. scripts/docker-smoke.sh passes, including the PROXY v1 check from the host through the Docker bridge; its container and image were removed by its own cleanup.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The Gemini listener now believes a PROXY header only when the TCP peer is loopback, private or link-local (IPv4-mapped forms included). A header from any other peer closes the connection, as with GEEKITY_TRUST_PROXY off; a plain TLS handshake from that peer is still served under its socket address. The check reuses util/public-address.ts, which gains isLocalAddress; trustProxy on the listener became a peer predicate. Tests: isLocalAddress unit test, and listener tests from a loopback peer (header address reaches throttle and log, predicate saw the TCP peer) and from a peer classified public (closed, nothing logged, TLS served). docs/deploying.md and docs/configuration.md name the trusted ranges and say a proxy on another public host is not trusted. Verified with the full pnpm build/test/test:11ty/typecheck/lint/format:check run and scripts/docker-smoke.sh.
<!-- SECTION:FINAL_SUMMARY:END -->
