---
id: decision-62
title: >-
  Editors autosave to a per-user copy under data/autosave with a browser
  fallback, and a distraction-free mode shows only the title and body
date: '2026-10-23 10:49'
status: accepted
---
## Context

The post and page editor is a plain form. CodeMirror 6 enhances it when JavaScript runs. Work is kept only when the writer presses Save draft, Publish or Update. If the browser closes, the tab crashes, or the server restarts mid-edit, everything since the last save is lost. There is no autosave, no `beforeunload` warning and no revision history. The only safeguard is the content-hash conflict check at save time (`conflictWith` in `content/write.ts`). The editor also always shows the admin shell and a sidebar of fields, which is a lot to look at while writing.

On 2026-10-23 the user asked for a fullscreen distraction-free writing mode, and for automatic saving in both views to a temporary copy, so a writer can resume after a crash or a closed browser. The user chose:

- a server copy, with the browser's localStorage as a fallback when the server cannot be reached;
- no Save button in distraction-free mode: autosave only, and the writer exits to save or publish.

## Decision

**An autosave is a copy, never the document.** While the editor is open, the bundle posts the whole form (as FormData with `csrf_token`, which the admin guard already accepts) to `POST /admin/autosave`. It does this after typing pauses for about two seconds, when a field loses focus, and on `pagehide`. The server writes the submitted fields, the base `hash` the form carries, the document's identity and a timestamp to `data/autosave/<userId>/<key>.json`, atomically. The content file, `locations.json` and every other store are left alone. A published post does not change until the writer presses Update. Micropub and the write path are unchanged.

- **The key** is the document's content path for an existing document. A new document has no path until it is saved, so it gets an id minted when the editor opens, carried in a hidden `autosave` field and in the URL (`/admin/posts/new?kind=note&autosave=<id>`). Reloading a new post therefore finds its own copy.
- **The class** of `data/autosave/**` is `pending` under decision-55: work not done yet, tied to this host, never exported. A site move should let writers finish or discard their copies first.
- **Ownership:** a copy belongs to the user who wrote it. Only that user can read, restore or discard it. Two users editing one post each get their own copy.
- **Clearing:** a successful save, publish, update or trash of the document deletes the saving user's copy for that key. Discard deletes it explicitly. Copies older than 30 days are pruned at boot.

**The browser keeps a fallback copy only while the server cannot be reached.** If an autosave POST fails on the network or with a 5xx, the bundle writes the same fields to localStorage under a key that names the site, the user and the autosave key. It keeps retrying the server. When a server autosave succeeds, the local copy is removed. The status line names where the copy lives: "Saved a copy at 12:03", "Server unreachable — saved in this browser at 12:03". A 4xx (expired session, CSRF) is not a network failure. The editor says so, keeps the local copy, and asks the writer to sign in again in another tab.

**Resume.** When the editor opens a document, the server looks for the user's copy. When the page loads, the bundle looks for a local copy. If a copy is newer than the document, a banner says "Unsaved changes from <time>" and offers Restore and Discard.

- Restore puts the copy's fields into the form and the editor; nothing is saved until the writer saves.
- If the copy's base hash no longer matches the file, the banner says the post has changed since. Restore then shows the two versions side by side, as the conflict screen does.
- If both a server copy and a local copy exist, the newer one is offered.
- The Posts and Pages lists gain an Unsaved filter. It lists the user's copies, including new documents never saved, each with Resume and Discard.
- With no JavaScript there is no autosave and no banner. A writer resumes a server copy from the Unsaved filter, where Resume opens the editor with the copy's fields filled in by the server.

**Distraction-free mode.** A Write in focus button in the editor (shortcut Ctrl/Cmd+Shift+F) adds a class to the editor page that does the following:

- hides the admin shell, the admin bar, the sidebar and every section except the title and body;
- widens the body into a centred column at a comfortable measure, in the admin's own theme;
- shows a quiet status line with the word count and the autosave status;
- requests the browser's Fullscreen API where it is allowed, and otherwise fills the window.

There is no Save button in this mode. Autosave keeps the work, and the writer exits to save or publish. Escape, the shortcut, or an Exit button leave the mode and return focus to the button that entered it; leaving browser fullscreen leaves the mode too. The choice is not remembered between visits. The mode exists only when JavaScript runs, because the plain form has nothing to hide behind.

## Consequences

- The admin gains one route family: `POST /admin/autosave`, `POST /admin/autosave/discard`, and the Unsaved list. All are mounted under the existing guard.
- The data census and the export list gain `autosave/**` as pending. `geekity export --list` shows it.
- A copy holds whatever the writer typed, including unpublished text. It sits in `data/` with the same protection as the rest of the site's data. A user's copies are deleted with the user.
- localStorage is per browser and per device. A local copy is offered only in the browser that made it.
- Two tabs on the same document write the same copy, last write wins. The base hash and the save-time conflict check still stop either tab from overwriting a newer file.
