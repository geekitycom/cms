/**
 * Tailwind scans this file (`@source` in admin/src/admin.css), so every class
 * name is written out in full.
 */
export interface Look {
  readonly surface: string;
  readonly tabs: string;
  /** DaisyUI draws the tab with `aria-selected="true"` as current. */
  readonly tab: string;
  readonly preview: string;
  readonly upload: string;
  readonly uploadButton: string;
  readonly status: string;
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
