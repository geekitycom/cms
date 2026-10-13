---
id: decision-52
title: >-
  A site is one container and its directory; foundational systems sit behind
  async interfaces a build can swap
date: '2026-10-13 12:09'
status: accepted
---
## Context

Geekity runs one website per process, in one Docker container. TASK-375 began as a review of the `geekity` CLI: operating a live site means SSHing in and running commands through `docker compose exec`. That review led to a wider question about how the CMS is built.

The first and main use case is a solo site: one person runs one Geekity site, self-hosted. Two other ideas exist for the future, and there are no plans to build either. The first is a "farm": an admin site plus several hosts, with a router that sends each subdomain or CNAME to the host serving that site. The second is an AWS build that replaces the local queue and database with Amazon SQS and Aurora. Neither idea adds requirements now. They only decide which seams are kept swappable.

A survey of the code on 2026-10-13 found the following:

- `createCms` (cms/create.ts) is the only place services are assembled. Every service is built from one `contentDir` and one `dataDir`.
- A caller can replace only a few parts through config: the clock, the mail provider, Fedify's KV store and queue, host lookup, the comment checker and the access log writer.
- About 15 in-process serial queues, three in-process event mechanisms, file I/O, throttles and IndieAuth's codes have no interface.
- `ContentStore` and `AdminStore` are interfaces, but they are synchronous because `node:sqlite` is synchronous. Code outside `store/` and `content/sqlite/` also imports `node:sqlite`.
- Runtime settings are split across two registries: core setting rows and plugin settings. Several credentials and flags are stored in their own files: mail, Akismet, maintenance and dev mode.

## Decision

1. **One container per site.** The solo self-hosted site is the target, and it runs as one container. If a farm is ever built, it would be a control plane plus a router in front of ordinary single-site containers. The farm adds no work now. Running more than one process for a site, or one process for many sites, is not a goal. Nothing is built for either.
2. **A site is its directory.** `content/` and `data/` hold everything. SQLite stays per site and can be rebuilt from the files (decision-1). To move a site, stop it, copy the directory and start it.
3. **Every file in `data/` has a declared class.** Each file is either kept or rebuildable, and a kept file may also be marked as a secret. A site export is a zip that follows these classes. It includes the kept files, such as actor keys, users and followers, and leaves out what can be rebuilt. Credentials are included only when the person exporting asks for them. A farm might later add a class for secrets it supplies, and the class model must leave room for that, but nothing is built for it now.
4. **Foundational systems sit behind interfaces that a build can swap.** An alternative image installs adapter packages and passes them to `createCms` from its config, as `config.mail.provider` and `config.federation.{kv,queue}` already work. Core is never forked. Every new interface is async from the start, even when its local implementation does not need to be. SQS and Aurora are patterns that the interfaces must not rule out. Nothing is built for them.
5. **Settings have one registry over many files.**
   - A setting is `namespace.key`. Each namespace declares its file and its data class. Core keeps `content/_data/site.json`. Each plugin gets its own file. Secrets and runtime flags stay under `data/`.
   - The registry reads every file and applies overrides in this order: config or env, then the file, then the default. It gives one interface to the admin and the CLI. A future farm could use the same interface.
   - The env variable is `GEEKITY_<NAMESPACE>__<KEY>`. The namespace never contains `__`, as `GEEKITY_PLUGIN_LLM__API_KEY` already works.
   - Core namespaces are reserved, and a plugin whose namespace clashes is refused.
6. **The registry owns only the data contract.** It holds the key, type, default, validation, storage, whether the value is a secret, overrides and change hook, plus a short description that the CLI can print. Admin pages are written independently, refer to settings by key, and choose their own layout, labels and widgets. A generic form renderer is optional. The registry does not import from the admin.
7. **Each foundation is built in a wave with its first real users.** In the same wave, every existing caller moves to it and the old one-off code is deleted. The order is the settings registry, then the job queue, then data classes and export, then async stores.
8. **CLI commands stay for now.** Maintenance and dev mode get admin switches through the settings registry. Strip-metadata and resend get admin actions through the job queue. Their CLI commands remain as thin layers over the same systems.

## Consequences

- No shared event bus, cross-process lock, leader election or per-site context object is built. The file watcher, scheduler, throttles and IndieAuth codes stay in-process.
- Plugin public settings move out of `plugins.<name>` in `site.json` into their own files. This needs a one-time migration that is safe to run twice.
- An Aurora build would require async stores, which change every caller up to routes and templates. This is the most expensive item and is sequenced last, behind a spike. A boundary test stops new `node:sqlite` imports outside the stores in the meantime.
- The job queue interface (TASK-380) is checked against BullMQ and RabbitMQ with throwaway adapters, and against SQS on paper.
- Fedify's message queue moves to a SQLite file of its own (TASK-379). This supersedes decision-5 for the queue.
