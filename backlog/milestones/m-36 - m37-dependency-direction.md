---
id: m-36
title: "M37 Dependency direction"
---

## Description

From the 2026-10-12 Clean Architecture review: the code inside files is clean, but about 50 pairs of top-level src directories import each other and the content domain imports from the delivery layer (web/, webmention/). This milestone points dependencies inward and makes the direction checkable.
