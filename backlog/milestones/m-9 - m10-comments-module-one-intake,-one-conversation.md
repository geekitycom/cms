---
id: m-9
title: "M10 Comments module: one intake, one conversation"
---

## Description

Deepen the comments seam found by the 2026-09-05 architecture review. Native comments, webmentions and moderator replies enter through one Comment intake that owns the checker call, the verdict rule and the file; the thread under a post, its counts and the site-wide latest are answered by one Conversation module that the page and the comments feeds both render from. No public output changes.
