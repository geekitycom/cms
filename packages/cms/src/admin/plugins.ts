/**
 * Admin > Plugins (decision-33): every installed plugin, where it stands, and
 * the Enable and Disable buttons that write the `plugins` key of
 * `content/_data/site.json`. The next request runs under the new set; there
 * is nothing to restart.
 */

import type { Context, Hono } from 'hono';

import type { GeekityEnv } from '../env.ts';
import { readEnabledPlugins, setPluginEnabled } from '../plugins/enabled.ts';
import { pluginFolderChanges, scanPluginFolders } from '../plugins/folder.ts';
import type {
  PluginRegistry,
  RegisteredPlugin,
  Requirement,
  RequirementState,
} from '../plugins/registry.ts';
import { resolvePluginSettings, savePluginSettings, SECRETS_FILE } from '../plugins/settings.ts';
import type { ResolvedSetting } from '../plugins/settings.ts';
import { pluginSite } from '../plugins/site.ts';
import type { AdminRender } from './documents.ts';
import type { AdminMenuChild } from './menu.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

export const PLUGINS_PATH = `${ADMIN_PREFIX}/plugins`;
export const PLUGINS_RELOAD_PATH = `${PLUGINS_PATH}/reload`;
export const PLUGINS_SECTION = 'plugins';
export const PLUGINS_CHILD = 'installed';

const PLUGIN_FIELD = 'plugin';

/** The query the new worker's screen is reached with after a reload. */
const RELOADED_QUERY = 'reloaded';

/** The form fields of a plugin's screen: which button, each box, each forget switch. */
const ACTION_FIELD = 'action';
const SAVE_ACTION = 'save';
const SETTING_PREFIX = 'setting.';
const FORGET_PREFIX = 'forget.';

type PluginState = 'enabled' | 'blocked' | 'disabled' | 'unavailable';

/** The badge each state draws, from `components/badge.njk`. */
const STATE_BADGES: Readonly<Record<PluginState, { status: string; label: string }>> = {
  enabled: { status: 'active', label: 'Enabled' },
  blocked: { status: 'pending', label: 'Enabled, not running' },
  disabled: { status: 'hidden', label: 'Disabled' },
  unavailable: { status: 'failed', label: 'Unavailable' },
};

/** How a requirement reads after "which is". */
const REQUIREMENT_WORDS: Readonly<Record<RequirementState, string>> = {
  enabled: 'enabled',
  blocked: 'enabled but not running',
  disabled: 'disabled',
  unavailable: 'unavailable',
  missing: 'not installed',
};

/** The id of a plugin's row, which a requirement links to. */
export function pluginAnchor(name: string): string {
  return `plugin-${name.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/** The screens of the plugins running for this request, as menu entries. */
export function pluginScreens(c: Context<GeekityEnv>): AdminMenuChild[] {
  return c.var.plugins.plugins
    .filter((entry) => hasScreen(entry) && c.var.activePlugins.has(entry.plugin.name))
    .map((entry) => ({
      child: entry.plugin.name,
      label: entry.screen?.title ?? entry.plugin.label,
      url: pluginScreenPath(entry.plugin.name),
    }));
}

/** A plugin has a screen when it draws one or has settings to draw on one. */
function hasScreen(entry: RegisteredPlugin): boolean {
  return entry.screen !== undefined || entry.settings.length > 0;
}

/** Where a plugin's screen is: under Plugins, by package name. */
export function pluginScreenPath(name: string): string {
  return `${PLUGINS_PATH}/${name}`;
}

export function mountPluginsScreen(app: Hono<GeekityEnv>, options: { render: AdminRender }): void {
  const { render } = options;

  app.get(PLUGINS_PATH, (c) => {
    const registry = c.var.plugins;
    const enabled = readEnabledPlugins(c.var.config.contentDir);
    const running = registry.active(enabled);

    const supervision = c.var.supervision;
    const changes =
      supervision === undefined
        ? undefined
        : pluginFolderChanges(supervision.loaded, scanPluginFolders(c.var.config.pluginsDir));

    return render(c, ADMIN_TEMPLATES.plugins, {
      section: PLUGINS_SECTION,
      child: PLUGINS_CHILD,
      reload: changes === undefined ? undefined : { url: PLUGINS_RELOAD_PATH, changes },
      reloaded: c.req.query(RELOADED_QUERY) !== undefined,
      reloadFailure: supervision?.lastFailure,
      enableUrl: `${PLUGINS_PATH}/enable`,
      disableUrl: `${PLUGINS_PATH}/disable`,
      field: PLUGIN_FIELD,
      plugins: registry.plugins.map(({ plugin, source, problem }) => {
        const requirements = registry.requirements(plugin.name, enabled);
        const state: PluginState =
          problem !== undefined
            ? 'unavailable'
            : running.has(plugin.name)
              ? 'enabled'
              : enabled.has(plugin.name)
                ? 'blocked'
                : 'disabled';
        return {
          anchor: pluginAnchor(plugin.name),
          name: plugin.name,
          label: plugin.label,
          description: plugin.description,
          version: plugin.version,
          source,
          problem,
          badge: STATE_BADGES[state],
          requirements: requirements.map((requirement) => ({
            ...requirement,
            words: REQUIREMENT_WORDS[requirement.state],
            satisfied: requirement.state === 'enabled',
            anchor: requirement.state === 'missing' ? undefined : pluginAnchor(requirement.name),
          })),
          canEnable:
            state === 'disabled' && requirements.every((entry) => entry.state === 'enabled'),
          canDisable: state === 'enabled' || state === 'blocked',
        };
      }),
    });
  });

  app.post(PLUGINS_RELOAD_PATH, async (c) => {
    const supervision = c.var.supervision;
    if (supervision === undefined) {
      return refuse(c, 'This server is not supervised by geekity serve, so it cannot reload.');
    }
    const outcome = await supervision.reload();
    if (!outcome.ok) return c.redirect(PLUGINS_PATH, 303);
    c.header('Connection', 'close');
    return c.redirect(`${PLUGINS_PATH}?${RELOADED_QUERY}=1`, 303);
  });

  app.post(`${PLUGINS_PATH}/enable`, async (c) => {
    const registry = c.var.plugins;
    const found = registry.find(await submittedName(c));
    if (found === undefined) return refuse(c, 'No plugin by that name is installed.');

    const { label, name } = found.plugin;
    const contentDir = c.var.config.contentDir;
    const enabled = readEnabledPlugins(contentDir);
    const reason = found.problem ?? unmet(registry.requirements(name, enabled));
    if (reason !== undefined) return refuse(c, `${label} was not enabled. ${reason}`);

    await setPluginEnabled({ contentDir, name, enabled: true });
    await registry.reconcile(readEnabledPlugins(contentDir));
    flash(c, 'notice', `${label} is enabled.`);
    return c.redirect(PLUGINS_PATH, 303);
  });

  app.post(`${PLUGINS_PATH}/disable`, async (c) => {
    const registry = c.var.plugins;
    const found = registry.find(await submittedName(c));
    if (found === undefined) return refuse(c, 'No plugin by that name is installed.');

    const { label, name } = found.plugin;
    const contentDir = c.var.config.contentDir;
    const dependents = registry.enabledDependents(name, readEnabledPlugins(contentDir));
    if (dependents.length > 0) {
      const named = dependents.map((dependent) => described(registry, dependent));
      const those = dependents.length === 1 ? 'that' : 'those';
      const verb = dependents.length === 1 ? 'requires' : 'require';
      return refuse(
        c,
        `${label} was not disabled. ${list(named)} ${verb} it; disable ${those} first.`,
      );
    }

    await setPluginEnabled({ contentDir, name, enabled: false });
    await registry.reconcile(readEnabledPlugins(contentDir));
    flash(c, 'notice', `${label} is disabled.`);
    return c.redirect(PLUGINS_PATH, 303);
  });

  app.get(`${PLUGINS_PATH}/*`, (c) => {
    const found = screenedPlugin(c);
    if (found === undefined) return c.notFound();
    return drawScreen(c, found, {});
  });

  app.post(`${PLUGINS_PATH}/*`, async (c) => {
    const found = screenedPlugin(c);
    if (found === undefined) return c.notFound();
    const back = pluginScreenPath(found.plugin.name);
    const body = await c.req.parseBody();
    const pressed = body[ACTION_FIELD];

    if (pressed === SAVE_ACTION && found.settings.length > 0) {
      const values: Record<string, string> = {};
      const forget = new Set<string>();
      for (const [field, value] of Object.entries(body)) {
        if (typeof value !== 'string') continue;
        if (field.startsWith(SETTING_PREFIX)) values[field.slice(SETTING_PREFIX.length)] = value;
        if (field.startsWith(FORGET_PREFIX)) forget.add(field.slice(FORGET_PREFIX.length));
      }
      const { problems } = await savePluginSettings({ ...found.settingsPlace, values, forget });
      if (Object.keys(problems).length > 0) {
        return drawScreen(c, found, { problems, submitted: values }, 400);
      }
      flash(c, 'notice', 'Settings saved.');
      return c.redirect(back, 303);
    }

    const action = found.screen?.actions?.find((entry) => entry.id === pressed);
    if (action === undefined) {
      flash(c, 'error', 'That button is not on this screen.');
      return c.redirect(back, 303);
    }
    try {
      const outcome = await action.run({
        site: pluginSite({ admin: c.var.admin, config: c.var.config }),
      });
      flash(c, outcome.ok ? 'notice' : 'error', outcome.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      flash(c, 'error', `${action.label} failed: ${message}`);
    }
    return c.redirect(back, 303);
  });

  function screenedPlugin(c: Context<GeekityEnv>): RegisteredPlugin | undefined {
    const name = decodeURIComponent(new URL(c.req.url).pathname.slice(PLUGINS_PATH.length + 1));
    const found = c.var.plugins.find(name);
    return found !== undefined && hasScreen(found) && c.var.activePlugins.has(name)
      ? found
      : undefined;
  }

  function drawScreen(
    c: Context<GeekityEnv>,
    found: RegisteredPlugin,
    refused: { problems?: Record<string, string>; submitted?: Record<string, string> },
    status: 200 | 400 = 200,
  ): Response {
    const { plugin, screen } = found;
    const problems = refused.problems ?? {};
    const settings = resolvePluginSettings(found.settingsPlace).map((entry) =>
      settingView(entry, refused.submitted, problems[entry.field.key]),
    );
    c.status(status);
    return render(c, ADMIN_TEMPLATES.pluginScreen, {
      section: PLUGINS_SECTION,
      child: plugin.name,
      title: screen?.title ?? plugin.label,
      cards:
        screen?.render({ site: pluginSite({ admin: c.var.admin, config: c.var.config }) }) ?? [],
      postUrl: pluginScreenPath(plugin.name),
      actionField: ACTION_FIELD,
      saveAction: SAVE_ACTION,
      actions: screen?.actions ?? [],
      settings,
      problems: settings.filter((entry) => entry.error !== undefined),
      secretsFile: `data/plugins/${plugin.name}/${SECRETS_FILE}`,
    });
  }

  function refuse(c: Context<GeekityEnv>, message: string): Response {
    flash(c, 'error', message);
    return c.redirect(PLUGINS_PATH, 303);
  }
}

/**
 * One field as the form draws it. A secret carries where it is set and never
 * its value; a refused form shows what was typed in the public boxes.
 */
function settingView(
  entry: ResolvedSetting,
  submitted: Record<string, string> | undefined,
  error: string | undefined,
) {
  const { field } = entry;
  const shown =
    submitted === undefined
      ? entry.value
      : field.type === 'checkbox'
        ? submitted[field.key] !== undefined
        : (submitted[field.key] ?? '');
  return {
    key: field.key,
    type: field.type,
    id: `plugin-setting-${field.key}`,
    name: `${SETTING_PREFIX}${field.key}`,
    forgetName: `${FORGET_PREFIX}${field.key}`,
    label: field.label,
    hint: field.hint,
    value: field.type !== 'secret' && typeof shown === 'string' ? shown : '',
    checked: shown === true,
    options:
      field.type === 'select'
        ? field.options.map((option) => ({ ...option, selected: option.value === shown }))
        : [],
    error,
    stored: entry.problem,
    source: entry.source,
    variable: entry.variable,
  };
}

/** Why the requirements stop an enable, one sentence each, or `undefined`. */
function unmet(requirements: readonly Requirement[]): string | undefined {
  const sentences = requirements
    .filter((requirement) => requirement.state !== 'enabled')
    .map(
      (requirement) =>
        `It requires ${requirement.name} ${requirement.range}, which is ${REQUIREMENT_WORDS[requirement.state]}.`,
    );
  return sentences.length === 0 ? undefined : sentences.join(' ');
}

function described(registry: PluginRegistry, name: string): string {
  const label = registry.find(name)?.plugin.label;
  return label === undefined ? name : `${label} (${name})`;
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

async function submittedName(c: Context<GeekityEnv>): Promise<string> {
  const value = (await c.req.parseBody())[PLUGIN_FIELD];
  return typeof value === 'string' ? value : '';
}
