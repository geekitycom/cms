/**
 * What every settings page is made of.
 *
 * The settings used to be one form with twelve headings. They are six pages
 * now — General, Reading, Permalinks, Discussion, Email and Federation — and
 * this is what they have in common: a description of the page, and the one
 * pair of routes that turns it into a screen you can read and a form you can
 * save. A page module describes itself and writes its own template; nothing
 * about how a page is wired lives in the page.
 *
 * The save is the part worth reading twice. A page writes only the fields it
 * carries, and it writes them onto `content/_data/site.json` as re-read inside
 * the atomic update (decision-9), not onto the copy the form was rendered
 * from. So two people saving two different pages at the same moment both land:
 * the second save is applied to what the first one actually wrote, and a
 * setting neither page shows is not even in the picture.
 */

import type { Context, Hono } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../env.ts';
import type { DeliveryReport } from '../federation/delivery.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import {
  formFromSettings,
  readSiteSettings,
  SETTINGS_FIELDS,
  SETTINGS_PATH,
  settingsFromForm,
  settingsProblems,
  updateSiteSettings,
} from './settings.ts';
import type { SettingsField, SettingsForm, SiteSettings } from './settings.ts';

/** What {@link mountSettingsPage} needs from the admin around it. */
export interface MountSettingsOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/** A submitted form, before anything has been read out of it. */
export type SubmittedBody = Record<string, unknown>;

/** One page under Settings. */
export interface SettingsPage {
  /** The child of the Settings section it is, as `src/admin/menu.ts` names it. */
  child: string;
  /** What the menu calls it, and what the page is headed. */
  label: string;
  /** Where it is: {@link settingsPagePath}. */
  path: string;
  /** The template it renders, from {@link ADMIN_TEMPLATES}. */
  template: string;
  /** The settings it carries. Every setting is on exactly one page. */
  fields: readonly SettingsField[];
  /**
   * The settings as this page shows them, where what is stored is not what is
   * in effect. Only General has one, for the base URL a deployment overrides.
   */
  shown?: (config: ResolvedConfig, settings: SiteSettings) => SiteSettings;
  /** What the page renders beyond its own fields: a panel, a credential, a list. */
  panels?: (c: Context<GeekityEnv>, settings: SiteSettings) => Record<string, unknown>;
  /**
   * The fields this page does not read straight off the body, because
   * something other than the form decides them — a field rendered read-only
   * submits nothing, and a save must not clear it.
   */
  reads?: (options: {
    c: Context<GeekityEnv>;
    body: SubmittedBody;
    current: SiteSettings;
  }) => Partial<SettingsForm>;
  /**
   * What a save of this page sets off beyond the file, as the sentence the
   * flash adds. The side effect stays where the field is: the actor is told
   * about a profile change on the page the profile is on, and the relays are
   * reconciled on the page the relay list is on.
   */
  saved?: (
    c: Context<GeekityEnv>,
    before: SiteSettings,
    after: SiteSettings,
  ) => Promise<string> | string;
  /**
   * The page's own endpoints: a credential, a test message. Each is its own
   * POST so a refused one cannot lose an edit to a field.
   */
  endpoints?: (app: Hono<GeekityEnv>, options: MountSettingsOptions) => void;
}

/**
 * Where one settings page lives.
 *
 * General is `/admin/settings` itself rather than `/admin/settings/general`:
 * it is where the Settings heading lands, where every save that has nothing
 * better to say redirects, and the URL every older bookmark holds.
 */
export function settingsPagePath(child: string): string {
  return child === 'general' ? SETTINGS_PATH : `${SETTINGS_PATH}/${child}`;
}

/**
 * Register one settings page: the screen, the save, and whatever endpoints of
 * its own it has.
 *
 * Every read is of `content/_data/site.json` as it is at that moment, and a
 * save rewrites it: a page is a view of the file rather than of anything this
 * process remembers (decision-9). A form the page's own validator has anything
 * to say about is a 400 that writes nothing at all and comes back with the
 * problems on the fields that have them.
 */
export function mountSettingsPage(
  app: Hono<GeekityEnv>,
  page: SettingsPage,
  options: MountSettingsOptions,
): void {
  const { render } = options;

  app.get(page.path, (c) =>
    render(c, page.template, settingsScreen(c, page, readSiteSettings(c.var.config.contentDir))),
  );

  app.post(page.path, async (c) => {
    const body: SubmittedBody = await c.req.parseBody();
    const stored = readSiteSettings(c.var.config.contentDir);
    const submitted = pageForm(c, page, body, stored);

    // The themes directory goes in because one check needs the file system:
    // whether the name a page submitted is a theme that is actually there.
    const problems = settingsProblems(submitted, page.fields, {
      themesDir: c.var.config.themesDir,
    });
    if (Object.keys(problems).length > 0) {
      c.status(400);
      return render(c, page.template, {
        ...settingsScreen(c, page, stored),
        form: submitted,
        problems,
        hasProblems: true,
      });
    }

    // The change is applied to the settings re-read inside the write, so a
    // field this page does not carry is whatever the file says now rather than
    // whatever it said when the form was drawn. The recorded archive renames
    // come from there for the same reason: a save of the title must not undo a
    // term somebody renamed while this form was open.
    const settings = await updateSiteSettings({
      contentDir: c.var.config.contentDir,
      change: (current) =>
        settingsFromForm(pageForm(c, page, body, current), current.taxonomyRedirects),
    });

    const note = page.saved === undefined ? '' : await page.saved(c, stored, settings);
    flash(c, 'notice', `${page.label} settings saved.${note}`);
    return c.redirect(page.path, 303);
  });

  page.endpoints?.(app, options);
}

/** Everything one settings page's template renders. */
export function settingsScreen(
  c: Context<GeekityEnv>,
  page: SettingsPage,
  settings: SiteSettings,
): Record<string, unknown> {
  const shown = page.shown === undefined ? settings : page.shown(c.var.config, settings);

  return {
    section: 'settings',
    child: page.child,
    settingsUrl: page.path,
    settingsLabel: page.label,
    fields: SETTINGS_FIELDS,
    form: formFromSettings(shown),
    problems: {},
    // Whether to say "nothing was saved" over the form. A template cannot ask
    // an object whether it is empty, and every page would otherwise spell out
    // the list of its own fields to find out.
    hasProblems: false,
    ...page.panels?.(c, settings),
  };
}

/**
 * The whole form as this page's save means it: what is stored, with the
 * page's own fields taken from what was submitted.
 *
 * Every other field comes from `current` rather than from the body, which is
 * what makes a page write only its own settings — and it is read out of a
 * checkbox correctly for free, since a clear checkbox submits nothing at all
 * and only this page's checkboxes are read off the body.
 */
function pageForm(
  c: Context<GeekityEnv>,
  page: SettingsPage,
  body: SubmittedBody,
  current: SiteSettings,
): SettingsForm {
  const form = formFromSettings(current);
  for (const name of page.fields) form[name] = bodyField(body[SETTINGS_FIELDS[name]]);
  return { ...form, ...page.reads?.({ c, body, current }) };
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
export function bodyField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The sentence a flash adds about the followers, when there were any: a save
 * of the profile is also an announcement, and it should say so rather than
 * leave the admin wondering.
 */
export function toldFollowers(report: DeliveryReport | undefined): string {
  const total = report?.deliveries.length ?? 0;
  if (total === 0) return '';
  return total === 1
    ? ' One follower has been told.'
    : ` ${String(total)} followers have been told.`;
}
