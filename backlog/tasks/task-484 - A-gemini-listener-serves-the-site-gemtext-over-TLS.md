---
id: TASK-484
title: 'A gemini:// listener serves the site gemtext over TLS'
status: To Do
assignee: []
created_date: '2026-10-22 12:07'
labels:
  - gemini
  - public-site
milestone: m-45
dependencies:
  - TASK-481
  - TASK-483
references:
  - 'https://geminiprotocol.net/docs/protocol-specification.gmi'
  - packages/cms/src/cms/create.ts
  - packages/cms/src/supervisor/primary.ts
  - packages/cms/src/web/throttle.ts
ordinal: 409800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Serve the gemini representation over the Gemini protocol (decision-60): a TLS listener in the CMS process next to the HTTP one, on a configurable port (default 1965), off until enabled. It maps requests onto the same documents, listings and redirects as HTTP and answers with Gemini status codes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A setting enables Gemini; when on, Cms.serve() starts a TLS listener on GEEKITY_GEMINI_PORT (default 1965) with the certificate from the certificate task, and close() closes it
- [ ] #2 The listener survives a supervised reload the way the HTTP port does, with no window where 1965 refuses connections
- [ ] #3 Requests follow the Gemini spec: one absolute URL of at most 1024 bytes ending CRLF, read under a timeout; a malformed request gets 59, and a request for another host or scheme gets 53
- [ ] #4 gemini://host/path answers 20 text/gemini with the same body as /path index.gmi over HTTP; links in it are gemini-relative
- [ ] #5 Redirects map to 31 (permanent) and 30 (temporary); 404 to 51; 410 to 52; maintenance to 41 with its back-by time; a server error to 40
- [ ] #6 /search/ answers 10 with a prompt and runs the query sent back as the URL query string
- [ ] #7 Uploads and their image variants are served with 20 and their media type
- [ ] #8 Connections are throttled per client address like HTTP, and the access log records Gemini requests
- [ ] #9 Integration tests drive a real TLS client against the listener
<!-- AC:END -->
