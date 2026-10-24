---
id: m-45
title: "M46 Gemini"
---

## Description

A site is readable in Gemini clients: every page with a Markdown representation also has a gemtext one, served at a .gmi URL over HTTP and at gemini:// on its own TLS listener. Conversion is done by a new standalone package, @geekity/md2gemini, modelled on the archived Python md2gemini. Themes may provide .gmi.njk templates; otherwise their Markdown templates are converted. See decision-60.
