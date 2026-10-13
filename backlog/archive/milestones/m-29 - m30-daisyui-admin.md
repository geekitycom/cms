---
id: m-29
title: "M30 DaisyUI admin"
---

## Description

The admin is restyled on DaisyUI 5 over Tailwind v4 (decision-30): the stylesheet becomes a build product, every DaisyUI built-in theme is available and chosen per user, the screens are drawn from a library of Nunjucks component macros, and the admin bar becomes one shadow-rooted component on the admin and the public site with light and dark palettes of its own. The look is DaisyUI's, not a pixel copy of the WordPress-classic admin; the menu registry, the screens and their behaviour stay. Runs incrementally: legacy rules keep rendering under Tailwind without Preflight until the last task turns it on and deletes them.
