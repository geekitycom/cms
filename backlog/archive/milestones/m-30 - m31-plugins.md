---
id: m-30
title: "M31 Plugins"
---

## Description

Plugins for logic that is useful to some sites but does not belong in core (decision-33). The first is the WordPress ActivityPub compatibility, moved out of core behind the plugin it becomes. The second is an LLM service other plugins share. Two plugins consume it: post title and description suggestions, and tag suggestions ranked by tags.pub followers. Infrastructure and use cases are built together: each task adds an extension point together with the plugin that first uses it. The last task opens a mounted plugins folder for sites deployed on Docker.
