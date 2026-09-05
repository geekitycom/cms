---
title: Contact
permalink: /contact/
description: The page that carries the demo's contact form, and where a message sent from it ends up.
contact: true
navigation: true
---

`contact: true` in this page's front matter is the whole of it. One key, which
Eleventy ignores, puts the form below — the same shape as the `navigation: true`
beside it, which is what makes this page appear in the menu at the top.

Send yourself a message and follow it. It is written to `data/contact/` as a
JSON file before anything is emailed, and it is waiting on **Messages** in the
admin, with the unread count on the dashboard. Where the message is emailed is
the `contactEmail` setting, read when the submission arrives rather than when
this page is rendered: the address is on no render context, so no theme can
print it and it is in none of the bytes you are reading.

Nothing here runs any JavaScript. The form is a form.
