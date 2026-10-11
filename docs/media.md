# Media

## The media library

`/admin/media` lists every file under `content/uploads`, newest first by
modification time: a thumbnail for a picture and its extension at the same
size for anything else, the size in bytes, the date, the public URL, the
ready-made Markdown, and the documents that point at the file. A library that
has grown gets a pager, twenty-four files to a page.

The list is a walk of the directory on every request rather than a query.
Nothing records that an upload exists: the filesystem is the truth
(decision-1, decision-9), so a file copied in over ssh, pulled in by git, or
written by an Eleventy build is on the screen without a restart, and one
removed the same way is off it. The only question the index is asked is which
documents mention a URL, which is the one thing a directory cannot answer.

Each row carries the public URL and the ready-made Markdown — `![alt](url)`
for a picture, with its alt text from the library or empty when it has none or
is decorative, and `[name](url)` for anything else, from the same function the
editor's upload control pastes from — as readonly text fields, which select and
copy on their own. `admin/static/copy.js` reveals a Copy button beside each and
does nothing else, so the screen is complete before it loads and a browser
without the clipboard API is not shown a button that would fail.

The upload form is `storeUpload`, the same function behind `POST /admin/uploads`
alike: one allowlist, one signature check, one
`{yyyy}/{mm}/{slug}{ext}` naming rule, and one set of refusals, shown as a flash
on the next page rather than as the editor's JSON.

Delete asks when it should. A file nothing points at is deleted on the first
click. A file a document still mentions — anywhere in its body, as Markdown, as
HTML or in prose — brings back a confirmation naming every document that does,
linked to its editor and marked when it is in the trash, and only a form
carrying `confirm` goes through. Deleting the bytes does not change the
documents. The trash counts because a trashed post can be restored, and
restoring one whose picture went in the meantime is a broken post nobody was
warned about. The submitted path is resolved against `content/uploads` and
refused when it lands outside, so a form field cannot name a file elsewhere in
the content directory.

`deleteUpload` takes a `removeDerived` hook, called with the same
content-relative path once the original is gone. The original under
`content/uploads` is the only source of truth (decision-10) and anything
generated from it is derived state that must not outlive it; the hook defaults
to `removeImageVariants`, which takes the file's derived images with it. The
file's entry in `content/_data/media.json` goes too.

### Alt text

Every picture in the library has an alt-text field and a Decorative checkbox.
What they say is kept in `content/_data/media.json`, keyed by the file's path
under `content/uploads`, because it is public and cannot be rebuilt from
anything else (decision-9):

```json
{
  "2026/09/dog.jpg": { "alt": "A dog asleep on a rug" },
  "2026/09/rule.png": { "decorative": true }
}
```

The Markdown the library offers embeds a picture with its alt text, and a
decorative one with an empty alt, which renders `alt=""`. A file name is never
used as alt text: the editor's upload control embeds a fresh upload as
`![](…)`, for the author to describe. Once an image is in a post, the post's
own `![…](…)` is its alt text there, since the same picture can need
describing differently in two posts. Deleting an upload forgets its entry.

Publishing a post or page checks every image it shows. An image is described
when its `![…](…)` or `alt` says something, or when it is an upload the library
marks decorative. Anything else, including an `<img>` with no `alt` at all,
publishes with a warning that names each image. A site that sets
`requireAltText` gets a refusal instead, and nothing is written. A draft is
never checked.

A federated post carries each picture from `content/uploads` as an `Image`
attachment whose `name` is its alt text, which is where Mastodon reads the
description from. Decorative pictures are left out.

A picture's row also carries its alt text: a text field, a Decorative checkbox
that wins over the text, and a line saying which of the two the library holds
or that it holds neither. The form posts to `/admin/media/alt`, which writes
`content/_data/media.json` atomically, keeping every other entry. The file is
the truth (decision-9) and is read on each request, so an entry written by hand
shows up without a restart. `readAltTexts(contentDir)` and
`undescribedImages(html, library)` in `src/images/alt-text.ts` are what the
editor's publish check and the federated `Image` attachments read.

### Location and camera metadata

A phone photo carries where it was taken, when, and on what camera, and the
original under `content/uploads` is what the site serves at `/uploads/…`, puts
in every `<picture>` as the fallback, and federates as a photo post's
attachment. So `storeUpload` removes that metadata before the file is written,
for every upload: the editor's control, the media library, the Micropub media
endpoint and Micropub photos. It is not a setting.

| Format   | What goes                                                                                                                                       | What stays                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| JPEG     | EXIF (GPS, camera, lens, serial, time), XMP, IPTC, comments, other APPn segments, data after the image                                          | JFIF, the ICC profile, Adobe's colour flag, the orientation   |
| PNG      | `eXIf`, `tEXt`, `zTXt`, `iTXt` (XMP), `tIME` and private chunks                                                                                 | Image and colour chunks, APNG animation, the orientation      |
| WebP     | `EXIF`, `XMP ` and unknown chunks                                                                                                               | The bitstream, alpha, animation, ICC profile, the orientation |
| AVIF     | The contents of the Exif and XMP items, overwritten with an empty EXIF block and an empty XMP packet                                            | The picture, and its `irot`/`imir` orientation                |
| GIF      | Comment extensions and application extensions other than looping and ICC (XMP lives in one)                                                     | Frames, timing, looping                                       |
| MP4, M4V | `udta` (the `©xyz` location, camera), `meta` (the QuickTime location key) and `uuid` (XMP) boxes, in the movie, its tracks and at the top level | Every other box                                               |

Nothing is re-encoded. Segments, chunks and blocks are cut out and the pixel
data is copied byte for byte, so a stored JPEG or PNG decodes to the same
pixels as the upload. A picture taken sideways keeps a minimal EXIF block
holding its orientation and nothing else, so it still shows the right way up.
AVIF and MP4 keep their layout exactly: the metadata is overwritten in place
and a removed box becomes a zero-filled `free` box of the same size, so no
offset inside the file moves. A file whose structure cannot be followed far
enough to find its metadata is refused with a 415 rather than stored as it is.

Audio (MP3, M4A, Ogg), WebM, PDF and the text formats are stored as they
arrive. An episode's tags are its title and artwork, not where it was
recorded.

Files uploaded before this version still carry their metadata. Strip them
with

```sh
geekity strip-metadata
```

which rewrites each file under `content/uploads` that has something to remove,
prints what it removed, keeps the file's modification time (the library sorts
by it), and leaves alone, and names, a file it cannot read, exiting `1`. It is
safe to run again: a clean file is left as it is, and a second run reports
every file already clean. The derived variants under `data/images` never
carried metadata.

A site that keeps `content/` in git still has the old bytes in its history,
and so does every clone and fork of it. Removing them means rewriting that
history. One way: run `geekity strip-metadata`, copy `content/uploads`
somewhere outside the repository, remove it from every commit with
[`git filter-repo`](https://github.com/newren/git-filter-repo)
`--path content/uploads --invert-paths`, copy the stripped files back, commit
them, and force-push. That changes every commit hash, so anybody else with a
clone has to clone again.

## Image optimization

An uploaded photograph goes out at whatever size the camera made it unless
something narrows it, so the CMS derives smaller and more modern copies with
[sharp](https://sharp.pixelplumbing.com/) and offers them in the site's pages
(decision-10). The original under `content/uploads/` is never touched, never
re-encoded and never moved: it stays the only source of truth, and it is what
every representation but the HTML page keeps pointing at.

Uploading a PNG, JPEG, WebP or AVIF writes, into
`data/images/{yyyy}/{mm}/{name}{ext}/`, one file per width per format —
`320.webp`, `320.png`, `640.webp` and so on — plus an `image.json` recording
the original's intrinsic width and height and everything derived from it. The
widths are [`imageWidths`](configuration.md#uploads-and-images), 11ty/image's own set by default;
nothing is ever upscaled, and the original's own width is always added so a
wide display has a full-size copy to pick that is not the unprocessed upload.
The formats are [`imageFormats`](configuration.md#uploads-and-images) plus the original's own, which
is what the `<img>` falls back to. EXIF orientation is applied and the metadata
— the camera, the timestamp, the location — is dropped. A GIF gets no variants
and is served as it was stored: an animation cannot survive being resized into
a still.

A post page then renders the picture as

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

The first image a page shows is the exception to `loading="lazy"`. It is
usually the page's Largest Contentful Paint, and waiting to lazy-load it slows
that paint down, so it carries `fetchpriority="high"` and no `loading` instead.
On a single post or page that is the first image in the body. On a listing, and
on a front page that lists `newestPosts` under its words, it is the first image in the
page's own body when that has one, and otherwise the first image of the first
entry. Every other image stays lazy.

`sizes` is `100vw`, which is 11ty/image's default and the only honest one a CMS
can give: how wide a picture is drawn is a fact about the theme's stylesheet.
Attributes the author wrote win — a hand-written `width`, `loading`,
`fetchpriority` or `srcset` is left alone — and an image pointing at another origin is untouched.

Only the theme's HTML gets that markup. The RSS and Atom `content:encoded`, the
JSON and Markdown representations of a document and the ActivityStreams
`content` a fediverse instance fetches all keep the plain `<img>` of the
original, because none of those readers can resolve this site's derived files
sensibly.

`data/images/` is derived state and may be deleted at any moment, exactly as
the SQLite index may (decision-9). A request for a file that is not there
rebuilds the whole set for that source and serves it; a request for a width or
a format the site does not offer is a 404 and encodes nothing. The directory is
inside `data/`, so git ignores it, the content sync never sees it and an
Eleventy build never reads it.

Turning `imageOptimization` off changes nothing on disk and nothing in the
feeds: the pages go back to the plain `<img>`, and uploading stops encoding.

### The same pictures from an Eleventy build

A site that builds the same `content/` with Eleventy gets equivalent markup
from [`@11ty/eleventy-img`](https://github.com/11ty/image) over the same
originals — which is why the CMS's width set and output shape are that
plugin's. The CMS's own `data/images/` is not involved; the plugin keeps its
own cache under `_site/img/`, and the two never meet.

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
uploads the CMS's renderer does. Keep the two width lists in step — a build and
a serve of the same directory should not disagree about what a reader is
offered.

### Image variants in code

`generateImageVariants(config, uploadPath)` derives one upload's copies with
sharp and writes them, plus an `image.json` sidecar, into
`<dataDir>/images/<the upload's path>/`. It runs inside `storeUpload`, so the
editor's control and the media library both produce the same
variants for the same file and the encoding is paid for by whoever uploaded it.
It answers `undefined`, having written nothing, for a GIF, an animation, a PDF,
a text file, an upload that is not there, and a site with `imageOptimization`
off — every one of which means "serve the original", which is what the site
would have done anyway.

| Function                           | What it is for                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `generateImageVariants`            | Derive the whole set and write the sidecar. Two callers at once share one encode.    |
| `describeImage`                    | The record, synchronously and cached, for a renderer that must not open a file.      |
| `findImageVariant`                 | One derived file by request path, generating it when it is missing.                  |
| `removeImageVariants`              | Take a source's derived directory away.                                              |
| `responsiveImages(html, describe)` | Rewrite `<img src="/uploads/…">` as `<picture>`. Pure: hand it any lookup.           |
| `siteImageMarkup(config, html)`    | The same, over one site's own records, deriving in the background for a record miss. |
| `siteIcons(config, setting)`       | The head's icon links for a site's icon setting: `{ rel, sizes, href }`, or none.    |

`describeImage` is synchronous and cached because it is called once per image
while a page renders, and decision-10 forbids probing an image file at render
time. Its cache entry outlives the sidecar on purpose: `data/images/` is
disposable, so a page whose variants have been swept away keeps rendering the
markup that asks for them back, and the first request for each one rebuilds it.

The site's icons are derived copies of the same kind, and `siteIcons` is how a
head gets at them: three square PNGs, `icon` at 32 and 16 pixels and
`apple-touch-icon` at 180, cropped from the middle of the site's icon (the
`icon` that Settings > General writes, else a hand-set `avatar`) and
encoded the first time a browser asks for one. It answers an empty list — and
the packaged theme then links no icon at all — when the site has no icon, when
its icon is a file no icon can be made of, or when `imageOptimization` is off,
so a head never advertises a URL this server would answer 404 for.

`documentContext(document, images)` is where the rewrite is applied. Passing the
config is what turns the page's `content` into `<picture>` markup; the feeds,
`documentJson`, the Markdown representation and `postObject` all read
`document.html` directly and so keep the plain `<img>` by construction.
