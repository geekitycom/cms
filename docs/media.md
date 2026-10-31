# Media

## The media library

`/admin/media` shows every file under `content/uploads` as a grid of square
tiles, newest first by modification time. A tile shows a thumbnail for a
picture, or the file's extension for anything else, and the file name under
it. Two badges mark what needs doing:

- **No alt text** on a picture with neither alt text nor a decorative flag
- **Unused** on a file that nothing uses: no document, live or in the trash,
  and no setting or user profile (see [What uses a file](#what-uses-a-file))

A thumbnail is the narrowest derived copy, in the first configured format, that
is at least 400 pixels wide. A picture with no variants yet shows the original.

Above the grid, tabs pick a kind of file (All, Images, Audio, Video, Documents)
and show how many files each holds. A filter form below them searches file
names and alt text, keeps only files that need alt text or that nothing uses,
and sorts by newest, oldest, largest or name. The filters are query parameters
(`kind`, `q`, `alt=missing`, `unused=1`, `sort`), so a filtered view is a link,
and the page links keep them. When a view holds more than twenty-four files, a
pager splits it into pages of twenty-four.

**Upload** above the grid opens the upload form.

Each tile links to the file's details screen, `/admin/media/file?path=…`. It
shows:

- a preview: the picture, an audio or video player, or the extension
- the upload date, the size, the dimensions of a picture with variants, and the
  path under `content/uploads`
- the alt-text form, for a picture
- the public URL and the ready-made Markdown
- what uses the file: documents, settings and user profiles, each linked to
  where it is changed
- **Delete**

**Previous** and **Next** step through the view the screen was opened from. The
rest of the query string is that view, so stepping from a file that needs alt
text goes to the next file that needs alt text. The file on screen always
counts as part of its view, so a picture you have just described still has
Previous and Next links.

With JavaScript on, `static/media.js` opens a tile's details screen in a dialog
over the grid, and the left and right arrow keys step to the previous and next
file. The forms in the dialog post as they do on the details screen. With
JavaScript off, every tile is a link and every form posts on its own.

The server walks the directory on every request. No record says that an upload
exists, because the files on disk are the record (decision-1, decision-9). A
file copied in over ssh, pulled in by git, or written by an Eleventy build
appears without a restart. A file removed the same way disappears. The library
asks the index one question: which documents mention a URL. A directory walk
cannot answer that.

### What uses a file

One answer serves the Used by list, the Unused badge, the "not used anywhere"
filter and the Delete confirmation. A file is used by:

- a document, live or in the trash, whose body or front matter names it. Every
  front-matter value counts, however deeply it nests: a photo post's `photo`
  list, a review's `item.photo.url`, or a key a theme reads.
- a setting that names it. The site icon (`icon`) links to Settings > General.
  The old site `avatar`, which the icon falls back to, is also listed under
  General. A setting on another settings page links to that page. A plugin's
  setting links to Settings. Secret settings are not read.
- a user's avatar, or any other field of their profile, which links to that
  user's screen under Users.

A value names a file when it contains the file's URL (`/uploads/2026/10/a.jpg`),
the same URL percent-encoded, or the directory of its derived images
(`/uploads/_/2026/10/a.jpg/…`). An absolute URL on the site's host contains the
site-relative one, so it counts too. The match stops at the end of the
filename, so `a.jpg` is not matched by `a.jpg.bak` or `a-2.jpg`.

The server gathers documents, settings and profiles once per request and
checks every file against that one list.

The public URL and the Markdown are readonly text fields, which select and copy
on their own. The Markdown is:

- `![alt](url)` for a picture, with its alt text from the library, or an empty
  alt when it has none or is decorative
- `[name](url)` for anything else

The same function builds the Markdown that the editor's upload control pastes.
`admin/static/copy.js` adds a Copy button beside each field and does nothing
else. The screen works before the script loads, and a browser without the
clipboard API shows no button that would fail.

The upload form calls `storeUpload`, the same function behind
`POST /admin/uploads`. Both share one allowlist, one signature check, one
`{yyyy}/{mm}/{slug}{ext}` naming rule, and one set of refusals. The library
shows a refusal as a flash message on the next page, not as the editor's JSON.

### Delete a file

If nothing uses a file, the first click on Delete deletes it.

If anything uses the file (see [What uses a file](#what-uses-a-file)), Delete
shows a confirmation. A mention in a body counts whether it is Markdown, HTML
or prose. The confirmation names everything that uses the file, links each one
to where it is changed, and marks documents in the trash. Only a form that
carries `confirm` deletes the file. Deleting the bytes does not change the
documents, settings or profiles.

Documents in the trash count because a trashed post can be restored. A
restored post whose picture was deleted is broken. The confirmation warns the
site owner before that happens.

The server resolves the submitted path against `content/uploads` and refuses it
when it lands outside. A form field cannot name a file elsewhere in the content
directory.

`deleteUpload` takes a `removeDerived` hook. It calls the hook with the same
content-relative path after it deletes the original. The original under
`content/uploads` is the only source of truth (decision-10). Anything generated
from it is derived state and must not outlive it. The hook defaults to
`removeImageVariants`, which deletes the file's derived images.
`deleteUpload` also removes the file's entry from `content/_data/media.json`.

### Alt text

Every picture in the library has an alt-text field and a Decorative checkbox.
The library stores both in `content/_data/media.json`, keyed by the file's path
under `content/uploads`. The file is public and nothing else can rebuild it
(decision-9):

```json
{
  "2026/09/dog.jpg": { "alt": "A dog asleep on a rug" },
  "2026/09/rule.png": { "decorative": true }
}
```

The Markdown the library offers embeds a picture with its alt text. It embeds a
decorative picture with an empty alt, which renders `alt=""`. The CMS never
uses a file name as alt text. The editor's upload control embeds a fresh upload
as `![](…)`, and the author writes the description. Once an image is in a post,
the post's own `![…](…)` is its alt text there. The same picture can need a
different description in two posts. Deleting an upload deletes its entry.

Publishing a post or page checks every image it shows. An image counts as
described when its `![…](…)` or `alt` is not empty, or when it is an upload the
library marks decorative. Any other image, including an `<img>` with no `alt`
at all, publishes with a warning that names each image. If the site sets
`requireAltText`, publishing is refused instead and nothing is written. Drafts
are never checked.

A federated post carries its pictures as `Image` attachments. The attachment's
`name` is the alt text, and Mastodon reads the description from `name`. The
post's photos are always attached, because they are the post: a decorative
photo is attached with no `name`, and a photo from another site with no media
type. The images in a post's text are attached only when they are uploads the
library does not mark decorative.

A picture's details screen has three alt-text controls:

- a text field
- a Decorative checkbox, which overrides the text
- a line that says whether the library holds alt text, the decorative flag, or
  neither

The form posts to `/admin/media/alt` and returns to the details screen. The
server writes
`content/_data/media.json` atomically and keeps every other entry. The file is
the source of truth (decision-9) and the server reads it on each request, so an
entry written by hand appears without a restart. The editor's publish check and
the federated `Image` attachments read alt text through
`readAltTexts(contentDir)` and `undescribedImages(html, library)` in
`src/content/alt-text.ts`.

### Location and camera metadata

A phone photo records where it was taken, when, and on what camera. The site
serves the original under `content/uploads` at `/uploads/…`, uses it as the
fallback in every `<picture>`, and federates it as a photo post's attachment.
For that reason `storeUpload` removes the metadata before it writes the file.
It does this for every upload path: the editor's control, the media library,
the Micropub media endpoint and Micropub photos. It is not a setting.

| Format   | What goes                                                                                                                                       | What stays                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| JPEG     | EXIF (GPS, camera, lens, serial, time), XMP, IPTC, comments, other APPn segments, data after the image                                          | JFIF, the ICC profile, Adobe's colour flag, the orientation   |
| PNG      | `eXIf`, `tEXt`, `zTXt`, `iTXt` (XMP), `tIME` and private chunks                                                                                 | Image and colour chunks, APNG animation, the orientation      |
| WebP     | `EXIF`, `XMP ` and unknown chunks                                                                                                               | The bitstream, alpha, animation, ICC profile, the orientation |
| AVIF     | The contents of the Exif and XMP items, overwritten with an empty EXIF block and an empty XMP packet                                            | The picture, and its `irot`/`imir` orientation                |
| GIF      | Comment extensions and application extensions other than looping and ICC (XMP lives in one)                                                     | Frames, timing, looping                                       |
| MP4, M4V | `udta` (the `©xyz` location, camera), `meta` (the QuickTime location key) and `uuid` (XMP) boxes, in the movie, its tracks and at the top level | Every other box                                               |

Nothing is re-encoded. `storeUpload` cuts out segments, chunks and blocks and
copies the pixel data byte for byte. A stored JPEG or PNG decodes to the same
pixels as the upload. A picture taken sideways keeps a minimal EXIF block that
holds only its orientation, so it still displays the right way up.

AVIF and MP4 keep their layout. `storeUpload` overwrites the metadata in place
and replaces a removed box with a zero-filled `free` box of the same size. No
offset inside the file moves.

If `storeUpload` cannot follow a file's structure far enough to find its
metadata, it refuses the file with a 415. It does not store the file unchanged.

Audio (MP3, M4A, Ogg), WebM, PDF and the text formats are stored as they
arrive. An episode's tags hold its title and artwork, not where it was
recorded.

Files uploaded before this version still carry their metadata. To strip them,
press **Strip metadata from every upload** on **Tools > Maintenance**, or run:

```sh
geekity strip-metadata
```

Both queue the same `strip-metadata` [admin job](configuration.md#admin-jobs).
The job:

- rewrites each file under `content/uploads` that has metadata to remove
- keeps the file's modification time, because the library sorts by it
- leaves a file it cannot read unchanged and names it
- replaces each file by renaming a stripped copy over it, so a file is never
  half written
- deletes any `.geekity-strip` copy that an earlier sweep left behind when it
  was killed between writing the copy and renaming it. The media library
  never lists these copies.

The button returns at once, and the job runs in the server. The
**Maintenance** screen shows the latest sweep: queued, running with the files checked out of
the total, finished with the counts and each file it stripped, failed with the
error, or interrupted. The panel updates every few seconds without a page load
until the sweep ends, and so does the notice on the **Media** screen. Without
JavaScript, select **Check again** to see how far it got. While a sweep is
queued or running, the screen offers no second one.

Until a sweep has finished, the media library shows a one-line notice with a
**Strip it now** button and a link to the sweep on the Maintenance screen. Once
one has finished, the sweep has checked every older upload and `storeUpload`
cleaned every newer one, so the notice goes away.

The command runs the job in its own process and waits for it. It prints each
file it stripped and what it removed, names each file it could not read on
standard error, and exits `1` if there was one or if the job failed.

The job is safe to run again. It leaves a clean file unchanged, and a second
run reports every file as already clean. When the server stops or reloads
during a sweep, the job stops before the next file and the next server
continues it. Files it already stripped are then counted as already clean. The
derived variants under `data/images` never carried metadata.

If the site keeps `content/` in git, the old bytes remain in its history and in
every clone and fork. Removing them means rewriting that history. One way to do
it:

1. Run `geekity strip-metadata`.
2. Copy `content/uploads` somewhere outside the repository.
3. Remove it from every commit with
   [`git filter-repo`](https://github.com/newren/git-filter-repo)
   `--path content/uploads --invert-paths`.
4. Copy the stripped files back and commit them.
5. Force-push.

Rewriting history changes every commit hash. Anyone else with a clone has to
clone again.

## Image optimization

The CMS uses [sharp](https://sharp.pixelplumbing.com/) to derive smaller copies
in more modern formats, and offers them in the site's pages (decision-10).
Without them, an uploaded photograph goes out at the size the camera made it.
The original under `content/uploads/` is never touched, re-encoded or moved. It
stays the only source of truth, and every representation except the HTML page
points at it.

Uploading a PNG, JPEG, WebP or AVIF writes these files into
`data/images/{yyyy}/{mm}/{name}{ext}/`:

- one file per width per format, such as `320.webp`, `320.png` and `640.webp`
- an `image.json` that records the original's intrinsic width and height,
  everything derived from it, and a hash of the bytes it was derived from

The widths are [`imageWidths`](configuration.md#uploads-and-images), which
defaults to 11ty/image's own set. The CMS never upscales. It always adds the
original's own width, so a wide display can pick a full-size copy that is not
the unprocessed upload. A format that cannot hold the full size gets its
widest copy at its limit: WebP at 16383 pixels, AVIF at 16384 and JPEG at 65535
in either dimension.

The formats are [`imageFormats`](configuration.md#uploads-and-images) plus the
original's own format. The `<img>` falls back to the original's format. The CMS
applies the EXIF orientation and drops the metadata, including the camera, the
timestamp and the location.

A GIF gets no variants and is served as stored. Resizing an animation would
turn it into a still. Neither does an image larger than 60 megapixels, nor
one whose pixels sharp cannot decode. The CMS records that nothing could be
derived and does not try again until the file changes.

A post page renders the picture as:

```html
<picture>
  <source
    type="image/webp"
    srcset="/uploads/_/2026/09/photo.jpg/320.webp?v=3f9a1c0e7b2d 320w, …"
    sizes="100vw"
  />
  <img
    src="/uploads/2026/09/photo.jpg"
    alt="A photo"
    srcset="/uploads/_/2026/09/photo.jpg/320.jpg?v=3f9a1c0e7b2d 320w, …"
    sizes="100vw"
    width="2400"
    height="1600"
    loading="lazy"
    decoding="async"
  />
</picture>
```

The first image on a page does not get `loading="lazy"`. It carries
`fetchpriority="high"` and no `loading` attribute. This image is usually the
page's Largest Contentful Paint, and lazy-loading it slows that paint down.
Which image is first depends on the page:

- On a single post or page, it is the first image in the body.
- On a listing, and on a front page that lists `newestPosts` under its words,
  it is the first image in the page's own body. If the page's body has no
  image, it is the first image of the first entry.

Every other image stays lazy.

`sizes` is `100vw`, which is 11ty/image's default. A CMS cannot know a better
value, because the theme's stylesheet decides how wide a picture is drawn.

Attributes the author wrote take precedence. The CMS leaves a hand-written
`width`, `loading`, `fetchpriority` or `srcset` alone. It does not touch an
image that points at another origin.

Only the theme's HTML gets this markup. These keep the plain `<img>` of the
original:

- the RSS and Atom `content:encoded`
- the JSON and Markdown representations of a document
- the ActivityStreams `content` that a fediverse instance fetches

The readers of those formats cannot resolve this site's derived files.

`data/images/` is derived state. You can delete it at any time, the same as the
SQLite index (decision-9). A request for a missing file rebuilds the whole set
for that source and serves it. A request for a width or a format the site does
not offer returns 404 and encodes nothing. Only the files the set lists are
served, never `image.json` or a file still being written. When the upload is
gone, a request for one of its derived files returns 404 and removes them. When
the upload is replaced in place, the next request derives the set again from
the new bytes. The directory is inside `data/`, so
git ignores it, the content sync does not see it, and an Eleventy build does
not read it.

Turning `imageOptimization` off changes nothing on disk and nothing in the
feeds. The pages go back to the plain `<img>`, and uploading stops encoding.

### The same pictures from an Eleventy build

A site that builds the same `content/` with Eleventy gets equivalent markup
from [`@11ty/eleventy-img`](https://github.com/11ty/image) over the same
originals. The CMS copies that plugin's width set and output shape for this
reason. The CMS's own `data/images/` is not involved. The plugin keeps its own
cache under `_site/img/`, and the two never share files.

```js
// eleventy.config.js, on top of the copied example config
import { eleventyImageTransformPlugin } from '@11ty/eleventy-img';

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(eleventyImageTransformPlugin, {
    widths: [320, 640, 960, 1280, 1920],
    formats: ['webp', 'auto'],
    defaultAttributes: { loading: 'lazy', sizes: '100vw' },
  });
}
```

The transform rewrites every `<img>` in the built HTML, so it finds the same
uploads the CMS's renderer does. Keep the two width lists the same, so that a
build and a serve of the same directory offer a visitor the same images.

### Image variants in code

`generateImageVariants(config, uploadPath)` derives one upload's copies with
sharp. It writes them, plus an `image.json` sidecar, into
`<dataDir>/images/<the upload's path>/`. It runs inside `storeUpload`, so the
editor's control and the media library produce the same variants for the same
file. The upload request pays the encoding cost.

It returns `undefined` and writes nothing for:

- a GIF
- an animation
- a PDF
- a text file
- an upload that does not exist
- an image over 60 megapixels, or one whose pixels cannot be decoded
- a site with `imageOptimization` off

In each of these cases the site serves the original.

| Function                           | What it is for                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `generateImageVariants`            | Derive the whole set and write the sidecar. Two callers at once share one encode.    |
| `describeImage`                    | The record, synchronously and cached, for a renderer that must not open a file.      |
| `findImageVariant`                 | One derived file by request path, generating it when it is missing.                  |
| `removeImageVariants`              | Take a source's derived directory away, after any encode writing into it.            |
| `responsiveImages(html, describe)` | Rewrite `<img src="/uploads/…">` as `<picture>`. Pure: hand it any lookup.           |
| `siteImageMarkup(config, html)`    | The same, over one site's own records, deriving in the background for a record miss. |
| `siteIcons(config, setting)`       | The head's icon links for a site's icon setting: `{ rel, sizes, href }`, or none.    |

`describeImage` is synchronous and cached because the renderer calls it once
per image, and decision-10 forbids probing an image file at render time. Its
cache entry outlives the sidecar on purpose. `data/images/` is disposable. When
a page's variants are deleted, the page keeps rendering markup that requests
them, and the first request for each variant rebuilds it.

The site's icons are derived copies of the same kind. `siteIcons` returns the
head's links to them. There are three square PNGs: `icon` at 32 and 16 pixels,
and `apple-touch-icon` at 180. The CMS crops them from the middle of the site's
icon. The site's icon is the `icon` that Settings > General writes, or else a
hand-set `avatar`. The CMS draws every icon at once, records them in
`icons.json` with a hash of the bytes they came from, and draws them again when
that upload changes. It draws them when Settings > General is shown, or in the
background on the first page render that needs them. Until they are drawn, the
head links no icon. Icon names are served only under the site icon's upload.

`siteIcons` returns an empty list in these cases, and the packaged theme then
links no icon:

- the site has no icon
- the icon is a file that no icon can be made from, or that is missing or
  cannot be decoded
- the icons have not been drawn yet
- `imageOptimization` is off

A head never links a URL that this server would answer with 404.

`documentContext(document, images)` applies the rewrite. Passing the config
turns the page's `content` into `<picture>` markup. The feeds, `documentJson`,
the Markdown representation and `postObject` all read `document.html` directly,
so they always keep the plain `<img>`.
