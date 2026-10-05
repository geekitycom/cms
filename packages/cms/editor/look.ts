/**
 * The classes the editor's script gives the markup it builds at runtime:
 * DaisyUI's components and Tailwind's utilities (decision-30).
 *
 * The admin's stylesheet reads this file for class names, so every name in
 * {@link LOOK} is written out in full.
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

export const LOOK: Look = {
  surface: '',
  tabs: 'tabs tabs-box tabs-sm me-auto',
  tab: 'tab',
  preview: 'block h-112 w-full rounded-field border border-base-300 bg-base-100',
  upload: '',
  uploadButton: 'btn btn-soft btn-sm',
  status: 'min-h-5 basis-full text-sm text-base-content/70',
  statusError: 'min-h-5 basis-full text-sm text-error',
};
