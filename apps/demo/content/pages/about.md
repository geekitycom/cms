---
title: About
permalink: /about/
description: Why a demo site ships inside the repository that builds the CMS.
---

The demo site exists so the CMS is always exercised the way a real site consumes
it: as a dependency resolved through the workspace, not as source on the import
path.

It is also the reference for `geekity init`. What the CLI scaffolds is a
smaller version of what is here — a config file, an entry file and a content
directory. It writes no `themes/`, because a site has one once it writes a
theme of its own and not before.
Anything the demo needs that a new site would need too belongs in the template,
not here.
