# @geekity/plugin-post-summary

A [Geekity CMS](../cms/README.md) plugin that suggests a post's title and
description in the editor. It asks the language model that
[`@geekity/plugin-llm`](../plugin-llm/README.md) connects the site to, and only
when the author presses a button. Nothing is sent when a post is saved or
published.

## Installing it

It requires `@geekity/plugin-llm` 0.2.0 or any later 0.x release, and works with
every 0.x release of `@geekity/cms` from the one it was built against, which
its peer dependency names. Add both packages to the site and to `plugins` in
its config:

```sh
pnpm add @geekity/plugin-llm @geekity/plugin-post-summary
```

```ts
import { defineConfig } from '@geekity/cms';
import llm from '@geekity/plugin-llm';
import postSummary from '@geekity/plugin-post-summary';

export default defineConfig({
  plugins: [llm, postSummary],
});
```

On Docker, add both packages to the plugins folder instead, then press Reload
under `/admin/plugins`:

```sh
docker compose exec geekity geekity plugin add @geekity/plugin-llm
docker compose exec geekity geekity plugin add @geekity/plugin-post-summary
```

Enable LLM under `/admin/plugins` and set its API key on its screen. Then
enable Post summary. It has no settings of its own: it uses the model chosen
on the LLM screen, which must support structured output.

## In the editor

The plugin puts two buttons in the post and page editor:

- **Suggest title** sits under Title.
- **Suggest description** sits under Description, in Summary and language.

A button sends the draft as it stands: the title, the body, the tags, the kind
of post and its language. Suggest title also sends the site's latest titles,
as described below. The suggestion appears under the button. **Accept**
puts it in the field, and **Dismiss** drops it. Accepting saves nothing; the
post is saved only by the editor's own buttons.

Suggest title is not offered for a like, a reply, a repost, an RSVP, a photo
post, or a note that was saved without a title, because those posts show no
title. It is offered for a new post with no title yet, which a title would make
an article. Suggest description is not offered for a read post, which is
described by its read line.

A title is asked for in about 60 characters at most, written the way the
author would write it. Suggest title also sends the titles of the site's five
latest posts that have one, so the model can match their style.

A description is at most 280 characters and 55 words: the length the default
theme's listings print and a feed's excerpt keeps. A longer answer is cut after
its last whole sentence that fits.

When the call fails, the reason appears under the button in plain words, such
as a missing API key or a model that cannot give structured answers, and the
editor goes on working. Without JavaScript the buttons are not shown.
