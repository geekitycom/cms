---
id: m-41
title: "M42 Dashboard: plugin hooks and built-in charts"
---

## Description

Dashboard › Home drops the Recent posts card and keeps its stat tiles. Plugins get two new contribution points: tags on every public page, and widgets on the dashboard. The core draws its own dashboard cards (fediverse engagement, follower history, recent interactions, top posts, posting activity, health, scheduled posts) through the same widget path, so the API is proven before a plugin depends on it. See decision-59.
