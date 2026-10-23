/**
 * Tailwind scans this file (`@source` in admin/src/admin.css), so every class
 * name is written out in full.
 */
export const LOOK = {
  tabs: 'tabs tabs-box tabs-sm',
  /** DaisyUI draws the tab with `aria-selected="true"` as current. */
  tab: 'tab',
  preview: 'block h-112 w-full rounded-field border border-base-300 bg-base-100',
  uploadButton: 'btn btn-soft btn-sm',
  videoControl: 'inline-flex flex-wrap items-center gap-2',
  videoAddress: 'input input-sm w-64',
  status: 'min-h-5 basis-full text-sm text-base-content/70',
  statusError: 'min-h-5 basis-full text-sm text-error',
  focusButton: 'btn btn-ghost btn-sm me-auto',
  focusSheet: 'fixed inset-0 z-100 overflow-y-auto rounded-none! bg-base-100 shadow-none!',
  focusColumn:
    'mx-auto box-content min-h-[calc(100dvh-4rem)] max-w-[70ch] gap-6! px-6! pt-16! pb-0! text-[1.0625rem] [&_.fieldset-legend]:text-xs [&_.fieldset-legend]:font-medium [&_.fieldset-legend]:text-base-content/55',
  focusTitle:
    'h-auto! border-transparent! bg-transparent! px-0! text-3xl! leading-tight font-bold shadow-none!',
  focusBar:
    'sticky bottom-0 mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-base-200 bg-base-100 py-3 text-sm text-base-content/60 [&>p]:min-h-0 [&>p]:basis-auto',
  wordsAnnounced: 'sr-only',
  focusExit: 'btn btn-ghost btn-sm ms-auto',
  resume: 'my-6',
  resumeAlert: 'alert alert-warning alert-vertical sm:alert-horizontal',
  resumeActions: 'flex flex-wrap gap-2',
  resumeRestore: 'btn btn-primary btn-sm',
  resumeDiscard: 'btn btn-soft btn-sm',
} as const;
