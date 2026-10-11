# @geekity/plugin-post-summary

A [Geekity CMS](https://github.com/geekitycom/cms/blob/main/packages/cms/README.md) plugin that suggests a post's title and
description in the editor. It asks the language model that
[`@geekity/plugin-llm`](https://github.com/geekitycom/cms/blob/main/packages/plugin-llm/README.md) connects the site to. It sends a
request only when the author presses a button. Saving or publishing a post
sends nothing.

## Installing it

It requires `@geekity/plugin-llm` 0.2.0 or any later 0.x release. It works with
every 0.x release of `@geekity/cms` from the one it was built against, which
its peer dependency names. Add both packages to the site and to `plugins` in
the site's config:

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
enable Post summary. It has no settings of its own. It uses the model chosen
on the LLM screen, which must support structured output.

## In the editor

The plugin puts two buttons in the post and page editor:

- **Suggest title** sits under Title.
- **Suggest description** sits under Description, in Summary and language.

A button sends the current draft: the title, the body, the tags, the kind of
post and its language. Suggest title leaves out the current title and sends
the site's latest titles instead, as described below. The suggestion appears
under the button. **Accept** puts it in the field, and **Dismiss** removes it.
Accepting saves nothing. Only the editor's own buttons save the post.

Suggest title is not offered for a like, a reply, a repost, an RSVP, a photo
post, or a note saved without a title, because those posts show no title. It
is offered for a new post with no title yet. Adding a title makes that post an
article. Suggest description is not offered for a read post, because its read
line describes it.

Suggest title asks for three titles, each about 60 characters at most, in the
author's style: one plain, one specific and one with more voice. It sends the
titles of the site's five latest posts that have a title, so the model can
match their style. It does not send the post's own title, because a model
that sees it tends to return it. Each title is listed with a radio button, and
the first is selected. Accept puts the selected title in Title, and the slug
updates as usual. The editor drops a title that matches the current one or
repeats another, ignoring case, spacing and trailing punctuation. If no title
is left, the editor says the model suggests keeping the current title, with
nothing to accept.

Suggest description returns one description, and the model does see the
title. If the description matches the current one, the editor says the model
suggests keeping it.

A description is at most 280 characters and 55 words. That is the length the
default theme's listings print and a feed's excerpt keeps. A longer answer is
cut after its last whole sentence that fits.

If the call fails, the reason appears under the button in plain words, such
as a missing API key or a model that cannot give structured answers. The
editor keeps working. Without JavaScript the buttons are not shown.
