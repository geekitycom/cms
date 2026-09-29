---
id: m-24
title: "M25 IndieAuth: sign in with your own site"
---

## Description

Geekity becomes its own IndieAuth server (https://indieauth.spec.indieweb.org/), so a user signs in to any IndieAuth client (indielogin.com, webmention.io, Quill) by typing their site URL and approving the request in their own admin, with no third-party provider behind rel="me". Phase 1 is authentication only (profile, email). Phase 2 issues scoped access tokens, the groundwork for a future Micropub endpoint.
