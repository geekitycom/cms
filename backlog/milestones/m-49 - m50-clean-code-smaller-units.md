---
id: m-49
title: "M50 Clean Code: smaller units"
---

## Description

Behaviour-preserving refactors from the 2026-10-24 Clean Code review. The architecture boundaries are sound; the work here breaks up the factory closures, route mounts and files that grew too large, removes duplicated parsing and redirect code, and moves ticket history out of source comments. No user-visible behaviour changes, and every existing test keeps passing unchanged in what it asserts.
