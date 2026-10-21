# @geekity/plugin-umami

A [Geekity CMS](https://github.com/geekitycom/cms/blob/main/packages/cms/README.md) plugin that adds the
[Umami](https://umami.is) analytics tracker to every public page. It works
with Umami Cloud and with a self-hosted Umami. The tracker is a `<script>` tag
at the end of `<head>`, which the CMS draws from the plugin's settings. The
site needs no theme of its own for it.

## Installing it

It works with every 0.x release of `@geekity/cms` from the one it was built
against, which its peer dependency names. Add the package to the site and to
`plugins` in the site's config:

```sh
pnpm add @geekity/plugin-umami
```

```ts
import { defineConfig } from '@geekity/cms/config';
import umami from '@geekity/plugin-umami';

export default defineConfig({
  plugins: [umami],
});
```

On Docker, add the package to the plugins folder instead:

```sh
docker compose exec geekity geekity plugin add @geekity/plugin-umami
```

Or press **Add plugin** under `/admin/plugins` and enter
`@geekity/plugin-umami`.

Then enable Umami under `/admin/plugins`, open its screen, and set the Umami
URL and the website ID. To read the stats as well, set the API settings that
[Reading the stats](#reading-the-stats) describes.

## Settings

| Setting                    | Key               | What it does                                                                                                                         |
| -------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Umami URL                  | `umami_url`       | Where Umami runs: `https://cloud.umami.is` for Umami Cloud, or the address of your own Umami. The tracker loads `script.js` from it. |
| Website ID                 | `website_id`      | The ID Umami shows for the site under Settings > Websites. It becomes `data-website-id`.                                             |
| Domains                    | `domains`         | Host names to count visits on, separated by commas, such as `example.com,www.example.com`. It becomes `data-domains`.                |
| Respect Do Not Track       | `do_not_track`    | Counts no visit from a browser that sends Do Not Track. It adds `data-do-not-track="true"`.                                          |
| Leave out the query string | `exclude_search`  | Records each page without its query string. It adds `data-exclude-search="true"`.                                                    |
| Leave out the fragment     | `exclude_hash`    | Records each page without its fragment. It adds `data-exclude-hash="true"`.                                                          |
| Count signed-in visits     | `count_signed_in` | Off by default, so a reader who is signed in to the site gets no tracker and your own visits are not counted.                        |

Until both the Umami URL and the website ID are set, the plugin adds nothing
to any page. With Domains empty, Umami counts visits on every host.

An environment variable overrides each setting. Its name is
`GEEKITY_PLUGIN_UMAMI__` followed by the key in upper case, such as
`GEEKITY_PLUGIN_UMAMI__WEBSITE_ID`. The plugin's screen prints each name.

With the URL `https://cloud.umami.is`, the website ID `a1b2c3` and Respect Do
Not Track on, every public page carries:

```html
<script
  src="https://cloud.umami.is/script.js"
  defer
  data-website-id="a1b2c3"
  data-do-not-track="true"
></script>
```

## Reading the stats

The plugin reads the website's stats from the Umami API. It signs in one of
two ways, which **Umami for the stats** chooses:

| Setting             | Key        | What it does                                                                                                                                                              |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Umami for the stats | `api_mode` | `cloud` for Umami Cloud, which takes an API key, or `self-hosted` for your own Umami, which takes a username and password. `cloud` unless set.                            |
| API key             | `api_key`  | For Umami Cloud: an API key made in Umami Cloud. It is sent as `Authorization: Bearer` and as `x-umami-api-key`.                                                          |
| Username            | `username` | For a self-hosted Umami: a user who can view the website.                                                                                                                 |
| Password            | `password` | For a self-hosted Umami: the password of that user.                                                                                                                       |
| API URL             | `api_url`  | Where the API answers, when it is not the usual place. Empty uses `https://api.umami.is/v1` for Umami Cloud, or the Umami URL followed by `/api` for a self-hosted Umami. |

The API key and the password are secrets. They are kept in `secrets.json` in
the plugin's data folder at mode 0600, or set by their environment variables
`GEEKITY_PLUGIN_UMAMI__API_KEY` and `GEEKITY_PLUGIN_UMAMI__PASSWORD`. They are
never drawn on a page and never logged. The plugin sends them only to the API
URL's origin: a redirect to another origin carries no credential.

A self-hosted Umami is signed in with `POST /api/auth/login`. The plugin keeps
the token it answers in memory and sends it as `Authorization: Bearer`. When
Umami refuses the token, the plugin signs in once more and repeats the request.
A user who signs in with two-factor authentication cannot be used; name a user
without it.

Each request gives up after 2.5 seconds, sign-in included, so a slow Umami
cannot hold up the dashboard.

**Check connection** on the plugin's screen asks Umami for the website. It
reports whether Umami answered, and whether it has a website with the
configured ID that the account can see.

The plugin is written against the Umami 3 API: `GET /websites/:id`, and its
`stats`, `pageviews`, `metrics` and `active` endpoints. It also reads the
Umami 2 answers to `stats` and `active`, which have a different shape. Umami 2
calls the `path` metric `url`, so the top pages need Umami 3.

## Where the tracker is drawn

The tag goes on every public HTML page: posts, pages, listings, search, the
front page and the error pages. It is left out of:

- pages drawn for a signed-in reader, unless Count signed-in visits is on
- every page while the site is in dev mode
- the editor's preview and the rest of the admin
- the feeds, `llms.txt`, and the Markdown, text and JSON representations of a
  page
- a site built with Eleventy, which runs no plugins. A static build needs the
  theme snippet described below.

## Moving from a theme snippet

A site that added Umami before this plugin existed has the tracker in a site
theme, usually in `partials/head-end.njk`, as
[Adding to every page](https://github.com/geekitycom/cms/blob/main/docs/theme/adding-to-every-page.md)
describes. If the snippet stays once the plugin is enabled, each page loads
the tracker twice and Umami counts each visit twice.

1. Enable the plugin. Set its Umami URL and website ID to the values in the
   snippet's `src` and `data-website-id`. Copy any other `data-` attribute the
   snippet sets into the matching setting.
2. Delete the Umami `<script>` from the theme's `partials/head-end.njk`. If
   the partial is then empty, delete the file.
3. On Docker, the theme is in the `themes/` folder that is mounted at
   `/site/themes`. Edit it there. The change shows on the next request.
4. Open a public page in a private window, where you are not signed in, and
   view its source. It has exactly one `script.js` tag from Umami.
