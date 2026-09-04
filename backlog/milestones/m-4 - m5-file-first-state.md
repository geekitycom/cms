---
id: m-4
title: "M5 File-first state"
---

## Description

Move every piece of irreducible state out of SQLite into files under content/ and data/ so the database is a disposable cache (decision-9). Settings, keys, users, followers and the inbox log become files; redeliver becomes resend-current-state; boot and geekity rebuild reconstruct the database from the filesystem.
