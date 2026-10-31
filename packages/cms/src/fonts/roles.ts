import type { JobStatus } from '../jobs/types.ts';
import { cssFontStackWith, isFontFamilyName } from '../theme/font-family.ts';
import type { CssFontStack } from '../theme/font-family.ts';
import type { ThemeFont } from '../theme/themes.ts';
import type { Clock } from '../util/clock.ts';
import type { FontStyle } from './family.ts';
import type { FontStore } from './store.ts';

/** How long after a failed fetch the next is queued; doubled per failure in a row. */
export const FONT_RETRY_MS = 60_000;

/** The longest wait between two fetches of a family that keeps failing. */
export const FONT_RETRY_MAX_MS = 60 * 60 * 1000;

export const FONT_ROLES = [
  {
    role: 'heading',
    setting: 'heading_font',
    fileKey: 'headingFont',
    styles: [{ weight: 700, italic: false }],
  },
  {
    role: 'body',
    setting: 'body_font',
    fileKey: 'bodyFont',
    styles: [
      { weight: 400, italic: false },
      { weight: 400, italic: true },
      { weight: 700, italic: false },
    ],
  },
] as const satisfies readonly {
  role: string;
  setting: string;
  fileKey: string;
  styles: readonly FontStyle[];
}[];

export type FontRole = (typeof FONT_ROLES)[number];

export interface PageFont {
  readonly font: ThemeFont;
  readonly family: string;
  /** The hosted `@font-face` stylesheet, same-origin and fingerprinted. */
  readonly href: string;
  /** What the role's custom property is set to: the family, then the theme's stack. */
  readonly value: CssFontStack;
}

/** The roles the theme declares that the site can set a font for, in {@link FONT_ROLES} order. */
export function declaredFontRoles(
  declared: readonly ThemeFont[],
): { readonly font: ThemeFont; readonly role: FontRole }[] {
  return FONT_ROLES.flatMap((role) => {
    const font = declared.find((each) => each.role === role.role);
    return font === undefined ? [] : [{ font, role }];
  });
}

function chosenFonts(
  site: Readonly<Record<string, unknown>>,
  declared: readonly ThemeFont[],
): { readonly font: ThemeFont; readonly role: FontRole; readonly family: string }[] {
  return declaredFontRoles(declared).map(({ font, role }) => {
    const named = site[role.fileKey];
    return { font, role, family: typeof named === 'string' ? named.trim() : '' };
  });
}

export interface PageFontsOptions {
  readonly store: FontStore;
  /** Queue a fetch of the family in these styles. Resolves with the job's id. */
  readonly refetch: (family: string, styles: readonly FontStyle[]) => Promise<string>;
  /** What became of a job the refetch queued. */
  readonly jobStatus: (id: string) => Promise<JobStatus | undefined>;
  readonly now: Clock;
}

/**
 * What a render knows about the fetch of a family whose files are missing:
 * a job it queued and has not seen end, or a failed one it waits out.
 */
type Fetching =
  | {
      readonly state: 'queued';
      readonly job: Promise<string>;
      /** Failed fetches in a row before this one. */
      readonly failures: number;
      /** Whether a render is already asking what became of the job. */
      checking: boolean;
    }
  | { readonly state: 'waiting'; readonly retryAt: number; readonly failures: number };

/**
 * The fonts a page is set in: each role the theme declares whose family the
 * site chose and whose files are here. A family whose files are gone is left
 * out, so the page falls back to the theme's stack, and a fetch of it is
 * queued. While the files stay missing, a render asks what became of that
 * job: one that failed is queued again once a back-off has passed, one that
 * finished or was forgotten is queued again at once.
 */
export function createPageFonts(
  options: PageFontsOptions,
): (site: Readonly<Record<string, unknown>>, declared: readonly ThemeFont[]) => PageFont[] {
  const { store, refetch, jobStatus, now } = options;
  const fetching = new Map<string, Fetching>();

  function queue(
    key: string,
    family: string,
    styles: readonly FontStyle[],
    failures: number,
  ): void {
    const job = refetch(family, styles);
    const entry: Fetching = { state: 'queued', job, failures, checking: false };
    fetching.set(key, entry);
    job.catch((thrown: unknown) => {
      if (fetching.get(key) === entry) fetching.delete(key);
      console.warn(`No fetch of the font ${family} was queued: ${String(thrown)}`);
    });
  }

  async function settle(
    key: string,
    entry: Fetching & { readonly state: 'queued' },
    family: string,
    styles: readonly FontStyle[],
  ): Promise<void> {
    const status = await jobStatus(await entry.job);
    if (fetching.get(key) !== entry) return;
    entry.checking = false;
    if (status?.state === 'queued' || status?.state === 'running') return;
    if (status?.state === 'interrupted') return;
    if (status?.state === 'failed') {
      const failures = entry.failures + 1;
      const wait = Math.min(FONT_RETRY_MS * 2 ** (failures - 1), FONT_RETRY_MAX_MS);
      const retryAt = Date.parse(status.finishedAt) + wait;
      if (now().getTime() >= retryAt) queue(key, family, styles, failures);
      else fetching.set(key, { state: 'waiting', retryAt, failures });
      return;
    }
    queue(key, family, styles, 0);
  }

  function wanted(key: string, family: string, styles: readonly FontStyle[]): void {
    const entry = fetching.get(key);
    if (entry === undefined) {
      queue(key, family, styles, 0);
    } else if (entry.state === 'waiting') {
      if (now().getTime() >= entry.retryAt) queue(key, family, styles, entry.failures);
    } else if (!entry.checking) {
      entry.checking = true;
      settle(key, entry, family, styles).catch((thrown: unknown) => {
        console.warn(`The fetch of the font ${family} could not be looked up: ${String(thrown)}`);
      });
    }
  }

  return (site, declared) =>
    chosenFonts(site, declared).flatMap(({ font, role, family }) => {
      if (!isFontFamilyName(family)) return [];
      const key = `${family}\n${role.role}`;
      const stylesheet = store.stylesheet(family, role.styles);
      if (stylesheet === undefined) {
        wanted(key, family, role.styles);
        return [];
      }
      fetching.delete(key);
      const value = cssFontStackWith(stylesheet.family, font.fallback);
      return value === undefined
        ? []
        : [{ font, family: stylesheet.family, href: stylesheet.href, value }];
    });
}
