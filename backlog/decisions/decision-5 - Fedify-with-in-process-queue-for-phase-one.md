---
id: decision-5
title: Fedify with in-process queue for phase one
date: '2026-09-02 13:21'
status: accepted
---
## Context

Fedify requires a key-value store (caching, actor documents) and a message queue (outgoing delivery, inbox processing). Persistent options exist for Redis, PostgreSQL, and SQLite (KV only). The CMS is a single process and phase one is a personal blog with a small follower count.

## Decision

Phase one uses `MemoryKvStore` and `InProcessMessageQueue`. Followers, key pairs, and the inbound activity log are stored in our own SQLite tables, so nothing that must survive a restart lives in Fedify's stores. The `Federation` object is created behind a small factory so the stores can be swapped by configuration.

## Consequences

- Deliveries queued at the moment the process exits are lost. Mitigation: the delivery worker records success per follower and a `federation redeliver` admin action can re-send an activity.
- Cached remote actor documents are refetched after every restart, which is acceptable at this scale.
- Moving to `@fedify/sqlite` KV or a Redis queue later is a configuration change, not a redesign.
