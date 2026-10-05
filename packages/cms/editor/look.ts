/**
 * The classes the editor's script gives the markup it builds at runtime, once
 * for each admin. `scripts/build-editor.js` builds `main.ts` twice and tells
 * each build which admin it is for (decision-30): the old admin's bundle keeps
 * its `admin-*` classes, and the DaisyUI admin's draws with DaisyUI's
 * components and Tailwind's utilities. The flip deletes {@link CLASSIC}.
 *
 * The DaisyUI admin's stylesheet reads this file for class names, so every
 * name in {@link DAISYUI} is written out in full.
 */
export interface Look {
  /** The box CodeMirror is mounted in. */
  readonly surface: string;
  /** The Write and Preview tab strip. */
  readonly tabs: string;
  /** One tab in it; DaisyUI draws the one with `aria-selected="true"` as current. */
  readonly tab: string;
  /** The frame the preview renders into. */
  readonly preview: string;
  /** What holds the Add file button and its file input. */
  readonly upload: string;
  /** The Add file button. */
  readonly uploadButton: string;
  /** The status line, saying what an upload or a preview is doing. */
  readonly status: string;
  /** The status line when what it says is that something failed. */
  readonly statusError: string;
}

export const CLASSIC: Look = {
  surface: 'admin-editor-surface',
  tabs: 'admin-editor-tabs',
  tab: 'admin-editor-tab',
  preview: 'admin-editor-preview',
  upload: 'admin-editor-upload',
  uploadButton: 'admin-button-quiet',
  status: 'admin-editor-status',
  statusError: 'admin-editor-status',
};

export const DAISYUI: Look = {
  surface: '',
  tabs: 'tabs tabs-box tabs-sm me-auto',
  tab: 'tab',
  preview: 'block h-112 w-full rounded-field border border-base-300 bg-base-100',
  upload: '',
  uploadButton: 'btn btn-soft btn-sm',
  status: 'min-h-5 basis-full text-sm text-base-content/70',
  statusError: 'min-h-5 basis-full text-sm text-error',
};
