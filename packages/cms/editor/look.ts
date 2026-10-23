/**
 * Tailwind scans this file (`@source` in admin/src/admin.css), so every class
 * name is written out in full.
 */
export const LOOK = {
  tabs: 'tabs tabs-box tabs-sm me-auto',
  /** DaisyUI draws the tab with `aria-selected="true"` as current. */
  tab: 'tab',
  preview: 'block h-112 w-full rounded-field border border-base-300 bg-base-100',
  uploadButton: 'btn btn-soft btn-sm',
  videoControl: 'inline-flex flex-wrap items-center gap-2',
  videoAddress: 'input input-sm w-64',
  status: 'min-h-5 basis-full text-sm text-base-content/70',
  statusError: 'min-h-5 basis-full text-sm text-error',
  /** The same classes the server's own resume banner carries. */
  resume: 'my-6',
  resumeAlert: 'alert alert-warning alert-vertical sm:alert-horizontal',
  resumeActions: 'flex flex-wrap gap-2',
  resumeRestore: 'btn btn-primary btn-sm',
  resumeDiscard: 'btn btn-soft btn-sm',
} as const;
