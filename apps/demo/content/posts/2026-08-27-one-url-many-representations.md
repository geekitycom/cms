---
title: One URL, many representations
date: '2026-08-27T19:40:00Z'
permalink: /2026/08/one-url-many-representations/
tags:
  - content
  - web
categories:
  - engineering
description: A post is a page, a Markdown file and a JSON object at the same address.
author: Andrew Shell
---

A post has one URL. What comes back from it depends on what you ask for.

| Ask for | Get |
| --- | --- |
| nothing in particular | this page, through the theme |
| `text/markdown` | the file as stored, front matter included |
| `application/json` | the front matter, the Markdown and the HTML |

The theme is the default representation because that is what a browser asks
for, not because HTML is privileged. The others are the same document seen from
a different angle.

> Files win. Everything else is derived.

Feed readers get their own fixed addresses, because they do not send an
`Accept` header worth negotiating over.
