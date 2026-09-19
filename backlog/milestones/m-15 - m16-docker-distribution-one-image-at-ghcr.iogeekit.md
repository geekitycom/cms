---
id: m-15
title: "M16 Docker distribution: one image at ghcr.io/geekitycom/cms running the default theme"
---

## Description

Geekity has only ever run as apps/demo, which is the integration bed for tests and wears its own demo theme. A real site needs a distribution. Ship one generic Docker image, ghcr.io/geekitycom/cms, that is nothing but @geekity/cms running `geekity serve`, set up entirely by environment variables and volumes: content/ and data/ are mounted from the host (the admin writes to content/, so unlike iheartrss nothing a site owns is baked into the image), themes/ is optional, and with no theme chosen the site wears the packaged default theme. On first boot with an empty content volume the image seeds the `geekity init` starter site and the first-run setup screen creates the admin. Images are built for linux/amd64 and linux/arm64 and pushed by hand with `pnpm docker:build-push`, tagged with the @geekity/cms version release-please sets, following /Users/andrewshell/code/projects/iheartrss (scripts/docker-build-push.sh, Dockerfile, docker-compose.yml). Deployment is dockge: a compose file pasted into a stack, the image pulled and never built on the box, behind an existing TLS reverse proxy. apps/demo stays the test bed and is not what gets deployed.
