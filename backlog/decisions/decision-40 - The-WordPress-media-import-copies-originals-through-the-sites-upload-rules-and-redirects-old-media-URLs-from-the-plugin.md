---
id: decision-40
title: >-
  The WordPress media import copies originals through the site's upload rules
  and redirects old media URLs from the plugin
date: '2026-10-09 18:01'
status: proposed
---
## Context

TASK-291.2 brings a WordPress site's media across. A WXR export lists each
attachment, with its `_wp_attached_file` and alt text, but carries none of the
files. Post bodies point at `https://<site>/wp-content/uploads/...`, often at a
size variant such as `-1024x575`, sometimes root-relative, and sometimes on the
staging host the site was built on. Links from elsewhere point at the same
URLs and cannot be edited.

Three choices are not settled by the acceptance criteria: which rules a copied
file is held to, how variant URLs are resolved, and where the
`/wp-content/uploads/` redirect lives. The plugin may only import types from
`@geekity/cms` at runtime (decision-33).

## Decision

- **A copied file is held to the editor's upload rules.** Core gains
  `PluginSite.checkUpload(name, bytes)`, which runs the same `acceptUpload` the
  editor's `storeUpload` runs: the site's allowed types, its size limit for the
  file's kind, the format's leading bytes, and location and camera metadata
  removed. It answers the bytes to store or why the site refuses the file, and
  writes nothing. A refused file is not copied and the report names it with the
  site's own reason. The site's allowlist is a security boundary (SVG is left
  out on purpose), so an import does not get round it, and a phone photo
  WordPress kept with its GPS tags arrives without them, as an upload through
  the editor would.
- **The original is what is copied, and what bodies point at.** An
  attachment's original is its `_wp_attached_file`, with WordPress's `-scaled`
  suffix removed. A URL naming an attachment original, or a `-WxH` or `-scaled`
  variant of one, becomes `/uploads/<original>`. A URL naming any other upload
  keeps its own path, and that file is copied too when the uploads directory
  has it, owned by the first post that shows it. The mapping reads only the
  export, never the disk, so a post's bytes do not depend on which files were
  present.
- **The hosts are explicit.** The export's own site and blog URLs always count,
  and `--origins` adds others, such as a staging host. An attachment's guid
  names the staging host on andrewshell.org, but a guid is an identifier, so it
  is not taken as one.
- **Keys in a shared JSON file are owned one at a time.** `ImporterOutput`
  carries `entries` (file, key, JSON value) in place of `settings`, so the
  `homepage` key of `_data/site.json` (decision-39) and each upload's alt text
  in `_data/media.json` follow the same rule: written while the site has not
  set the key or still holds what the import last set. `import.json` records
  them by file under `entries`.
- **The old media URLs redirect from the plugin, by rule.** A plugin route for
  `/wp-content/uploads/*` answers 301 at `/uploads/<path>`. When the path is a
  variant whose original the import copied, as `import.json` records it, it
  answers at that original instead. The query string is kept. No
  `redirects.json` entry is written per file. The rule is WordPress's naming,
  so it is the plugin's, and core gains no prefix redirect.

## Consequences

- The media redirects answer only while the plugin is enabled. The actor paths
  the plugin also serves are meant to be disabled once followers refetch; a
  site that still gets links to old media keeps the plugin enabled. The README
  cutover says so.
- A copied file may differ from WordPress's bytes once its metadata is
  stripped. The `/uploads/` URL and the file name stay the same.
- Every attachment is held in memory between reading and writing, since an
  importer returns its files whole. andrewshell.org's 25 attachments are a few
  tens of megabytes; a library of gigabytes would need the writer to read
  files lazily.
- Losing `import.json` makes a variant URL redirect at the variant's own
  `/uploads/` path, which the import never copied, until the next import
  writes the record again.
- A variant of a file that is no attachment is not resolved to an original:
  WordPress made variants only of attachments, so this is a file copied in by
  hand, and its name is kept.
