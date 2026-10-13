---
id: m-38
title: "M39 Foundational systems"
---

## Description

This milestone builds four foundations: the settings registry, the job queue, data classes with a site export, and async stores. Each foundation lands with its first real users. In the same wave, every existing caller moves over and the old code is deleted. The first use case is a solo self-hosted site. A farm or an AWS build is a future idea that only decides which seams stay swappable. See decision-52.

Work in this order. Task dependencies record the hard ones.

1. **Small fixes, in one PR.** TASK-382 (Fedify drain bug) and TASK-381 (the `node:sqlite` boundary test).
2. **The spikes that open the waves.** TASK-383 (settings registry) and TASK-380 (job queue) run in parallel. Each ends with a decision record and follow-up tasks. **Stop here.** The user reads and accepts each decision before any follow-up task is built. Each spike has an acceptance criterion for this.
3. **Build the waves.**
   - Wave 1 is the settings registry. Maintenance and dev mode are its first users and get admin switches. Every other setting moves onto it.
   - Wave 2 is the job queue. Strip-metadata and resend are its first users and become admin actions.
   - TASK-379 (Fedify on SQLite) comes after TASK-380, because that spike decides whether one backend carries both admin jobs and Fedify messages.
   - CLI commands stay, as thin layers over the new systems.
4. **The later spikes.** TASK-384 (data classes and export) builds on the namespaces from TASK-383. TASK-385 (async stores) comes last and may conclude "not yet".

The admin-move tasks are not filed by hand. They come as follow-ups of TASK-383 and TASK-380.
