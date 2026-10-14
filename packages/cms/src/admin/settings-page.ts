/**
 * What every settings page is made of.
 *
 * The settings used to be one form with twelve headings. They are seven pages
 * now — General, Reading, Permalinks, Discussion, Email and Privacy under Settings, and
 * Federation under its own section (TASK-109) — and this is what they have in
 * common: a description of the page, and the one pair of routes that turns it
 * into a screen you can read and a form you can save. A page module describes
 * itself and writes its own template; nothing about how a page is wired lives
 * in the page.
 */

import type { Context, Hono } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../web/env.ts';
import type { DeliveryReport } from '../federation/delivery.ts';
import { SITE } from '../site/settings.ts';
import type { SiteSettings } from '../site/settings.ts';
import { stringOrEmpty } from '../util/forms.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { setElsewhere } from './setting-overrides.ts';
import {
  formFromSettings,
  SETTINGS_FIELDS,
  settingOf,
  settingsProblems,
  siteChanges,
  submittedSettings,
} from './settings-fields.ts';
import type { SettingsField, SettingsForm, SettingsProblems } from './settings-fields.ts';
import { SETTINGS_PATH } from './settings.ts';

/** What {@link mountSettingsPage} needs from the admin around it. */
export interface MountSettingsOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/** A submitted form, before anything has been read out of it. */
export type SubmittedBody = Record<string, unknown>;

/** One settings page, wherever the menu files it. */
export interface SettingsPage {
  /** The child of its section it is, as `src/admin/menu.ts` names it. */
  child: string;
  /** What the menu calls it. */
  label: string;
  /**
   * The section it is under, when it is not Settings.
   *
   * Six of the seven are Settings' own children. Federation's is a child of
   * the Federation section instead (TASK-109): what a settings page is has
   * nothing to do with where the menu files it, so the page says where it is
   * and the rest of this module carries on as before.
   */
  section?: string;
  /**
   * What the page is headed and what a save says it saved, when the menu's
   * label is not that on its own. Only Federation has one: under its own
   * section it is listed as Settings, and "Settings settings saved" is not a
   * sentence.
   */
  heading?: string;
  /** Where it is: {@link settingsPagePath}, or its own section's path. */
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
  panels?: (
    c: Context<GeekityEnv>,
    settings: SiteSettings,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  reads?: (options: { c: Context<GeekityEnv>; body: SubmittedBody }) => Partial<SettingsForm>;
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
 */
export function mountSettingsPage(
  app: Hono<GeekityEnv>,
  page: SettingsPage,
  options: MountSettingsOptions,
): void {
  const { render } = options;

  app.get(page.path, async (c) =>
    render(c, page.template, await settingsScreen(c, page, c.var.siteAtRequestStart)),
  );

  app.post(page.path, async (c) => {
    const body: SubmittedBody = await c.req.parseBody();
    const site = c.var.siteAtRequestStart;
    const elsewhere = await setElsewhereOn(c, page);
    const editable = page.fields.filter((name) => elsewhere[settingOf(name)] === undefined);
    const submitted = pageForm(c, page, editable, body, site);

    const refuse = async (problems: SettingsProblems): Promise<Response> => {
      c.status(400);
      return render(c, page.template, {
        ...(await settingsScreen(c, page, site)),
        form: submitted,
        problems,
        hasProblems: true,
      });
    };

    const problems = settingsProblems(submitted, editable, {
      themesDir: c.var.config.themesDir,
      contentDir: c.var.config.contentDir,
    });
    if (Object.keys(problems).length > 0) return await refuse(problems);

    const result = await c.var.settings.set(
      'site',
      siteChanges(submittedSettings(submitted, editable)),
      'admin',
    );
    if (!result.ok) return await refuse(result.problems as SettingsProblems);

    flash(c, 'notice', `${pageHeading(page)} settings saved.`);
    return c.redirect(page.path, 303);
  });

  page.endpoints?.(app, options);
}

/** Everything one settings page's template renders. */
export async function settingsScreen(
  c: Context<GeekityEnv>,
  page: SettingsPage,
  settings: SiteSettings,
): Promise<Record<string, unknown>> {
  const elsewhere = await setElsewhereOn(c, page);

  return {
    section: page.section ?? 'settings',
    child: page.child,
    settingsUrl: page.path,
    settingsLabel: pageHeading(page),
    fields: SETTINGS_FIELDS,
    form: formFromSettings(shownOn(c, page, settings)),
    setElsewhere: Object.entries(elsewhere).map(([key, source]) => ({
      setting: `site.${key}`,
      source,
    })),
    problems: {},
    // Whether to say "nothing was saved" over the form. A template cannot ask
    // an object whether it is empty, and every page would otherwise spell out
    // the list of its own fields to find out.
    hasProblems: false,
    ...(await page.panels?.(c, settings)),
  };
}

/** What the page is headed, and what a save of it says it saved. */
function pageHeading(page: SettingsPage): string {
  return page.heading ?? page.label;
}

function shownOn(c: Context<GeekityEnv>, page: SettingsPage, settings: SiteSettings): SiteSettings {
  return page.shown === undefined ? settings : page.shown(c.var.config, settings);
}

async function setElsewhereOn(
  c: Context<GeekityEnv>,
  page: SettingsPage,
): Promise<Readonly<Record<string, string>>> {
  return await setElsewhere(c.var.settings, SITE, page.fields.map(settingOf));
}

function pageForm(
  c: Context<GeekityEnv>,
  page: SettingsPage,
  editable: readonly SettingsField[],
  body: SubmittedBody,
  site: SiteSettings,
): SettingsForm {
  const form = formFromSettings(shownOn(c, page, site));
  for (const name of editable) form[name] = stringOrEmpty(body[SETTINGS_FIELDS[name]]);
  const read = page.reads?.({ c, body }) ?? {};
  for (const name of editable) {
    const value = read[name];
    if (value !== undefined) form[name] = value;
  }
  return form;
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
