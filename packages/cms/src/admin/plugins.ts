/**
 * Admin > Plugins (decision-33): every installed plugin, where it stands, and
 * the Enable and Disable buttons that write the `plugins` key of
 * `content/_data/site.json`. The next request runs under the new set; there
 * is nothing to restart.
 */

import type { Context, Hono } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../env.ts';
import { ownManifest } from '../init.ts';
import { readPluginChanges } from '../plugins/changes.ts';
import type { PluginChangeEntry } from '../plugins/changes.ts';
import { readEnabledPlugins, setPluginEnabled } from '../plugins/enabled.ts';
import { pluginFolderChanges, scanPluginFolders } from '../plugins/folder.ts';
import {
  enabledRefusal,
  installedFolders,
  parsePackageSpec,
  pluginRegistry,
} from '../plugins/install.ts';
import {
  checkForUpdates,
  deletePlugin,
  installPlugin,
  lastUpdateCheck,
  updatePlugins,
} from '../plugins/manage.ts';
import type { ManageOptions, ManageOutcome } from '../plugins/manage.ts';
import { describeUpgrade } from '../plugins/upgrade.ts';
import { PACKAGE_NAME } from '../plugins/registry.ts';
import type {
  PluginRegistry,
  RegisteredPlugin,
  Requirement,
  RequirementState,
} from '../plugins/registry.ts';
import { resolvePluginSettings, savePluginSettings, SECRETS_FILE } from '../plugins/settings.ts';
import type { ResolvedSetting } from '../plugins/settings.ts';
import { pluginSite } from '../plugins/site.ts';
import { findUserById, verifyUserPassword } from './accounts.ts';
import type { AdminRender } from './documents.ts';
import { formatInTimezone } from './formatting.ts';
import type { AdminMenuChild } from './menu.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import { readSiteSettings } from './settings.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

export const PLUGINS_PATH = `${ADMIN_PREFIX}/plugins`;
export const PLUGINS_RELOAD_PATH = `${PLUGINS_PATH}/reload`;
const PLUGINS_ENABLE_PATH = `${PLUGINS_PATH}/enable`;
const PLUGINS_DISABLE_PATH = `${PLUGINS_PATH}/disable`;
export const PLUGINS_ADD_PATH = `${PLUGINS_PATH}/add`;
export const PLUGINS_CHECK_PATH = `${PLUGINS_PATH}/check`;
export const PLUGINS_CONFIRM_PATH = `${PLUGINS_PATH}/confirm`;
export const PLUGINS_UPDATE_PATH = `${PLUGINS_PATH}/update`;
export const PLUGINS_UPDATE_ALL_PATH = `${PLUGINS_PATH}/update-all`;
export const PLUGINS_REMOVE_PATH = `${PLUGINS_PATH}/remove`;

/** The screen's own paths, which no plugin's screen can take. */
const RESERVED_PATHS: ReadonlySet<string> = new Set([
  PLUGINS_RELOAD_PATH,
  PLUGINS_ENABLE_PATH,
  PLUGINS_DISABLE_PATH,
  PLUGINS_ADD_PATH,
  PLUGINS_CHECK_PATH,
  PLUGINS_CONFIRM_PATH,
  PLUGINS_UPDATE_PATH,
  PLUGINS_UPDATE_ALL_PATH,
  PLUGINS_REMOVE_PATH,
]);
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

/**
 * The package name a path under Plugins names a screen of, or `undefined` for
 * the screen's own paths and anything deeper, such as an editor action's.
 */
function screenName(c: Context<GeekityEnv>): string | undefined {
  const { pathname } = new URL(c.req.url);
  if (RESERVED_PATHS.has(pathname)) return undefined;
  const name = decodeURIComponent(pathname.slice(PLUGINS_PATH.length + 1));
  return PACKAGE_NAME.test(name) ? name : undefined;
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

  app.get(PLUGINS_PATH, (c) => drawPluginsScreen(c, {}));

  function drawPluginsScreen(
    c: Context<GeekityEnv>,
    addForm: { package?: string; version?: string; problems?: AddProblems },
    status: 200 | 400 = 200,
  ): Response {
    const registry = c.var.plugins;
    const { config } = c.var;
    const enabled = readEnabledPlugins(config.contentDir);
    const running = registry.active(enabled);
    const installer = pluginInstaller(config);
    const inCode = new Set(config.plugins.map((plugin) => plugin.name));
    const inFolder =
      installer.state === 'on'
        ? installedFolders(installer.pluginsDir)
        : new Map<string, unknown>();
    const check = installer.state === 'on' ? lastUpdateCheck(installer.pluginsDir) : undefined;
    const timezone = readSiteSettings(config.contentDir).timezone;

    const supervision = c.var.supervision;
    const changes =
      supervision === undefined
        ? undefined
        : pluginFolderChanges(supervision.loaded, scanPluginFolders(config.pluginsDir));

    c.status(status);
    return render(c, ADMIN_TEMPLATES.plugins, {
      section: PLUGINS_SECTION,
      child: PLUGINS_CHILD,
      reload: changes === undefined ? undefined : { url: PLUGINS_RELOAD_PATH, changes },
      reloaded: c.req.query(RELOADED_QUERY) !== undefined,
      reloadFailure: supervision?.lastFailure,
      enableUrl: PLUGINS_ENABLE_PATH,
      disableUrl: PLUGINS_DISABLE_PATH,
      field: PLUGIN_FIELD,
      installer: installer.state,
      add: {
        url: PLUGINS_ADD_PATH,
        package: addForm.package ?? '',
        version: addForm.version ?? '',
      },
      addProblems: addForm.problems ?? {},
      checkUrl: PLUGINS_CHECK_PATH,
      checkedAt:
        check === undefined ? undefined : formatInTimezone(check.at.toISOString(), timezone),
      updateAllUrl: inFolder.size > 0 ? confirmPath('update-all') : undefined,
      changeLog: readPluginChanges(config.dataDir).map((entry) => changeView(entry, timezone)),
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
        const checked = check?.plugins.find((entry) => entry.name === plugin.name);
        const manageable = inFolder.has(plugin.name) && !inCode.has(plugin.name);
        return {
          anchor: pluginAnchor(plugin.name),
          name: plugin.name,
          label: plugin.label,
          description: plugin.description,
          version: plugin.version,
          source,
          problem,
          badge: STATE_BADGES[state],
          inCode: inCode.has(plugin.name),
          update:
            manageable && checked?.status === 'available'
              ? { to: checked.to, url: confirmPath('update', plugin.name) }
              : undefined,
          checkNote:
            manageable &&
            checked !== undefined &&
            checked.status !== 'available' &&
            checked.status !== 'newest'
              ? describeUpgrade(checked)
              : undefined,
          removeUrl:
            manageable && !enabled.has(plugin.name)
              ? confirmPath('remove', plugin.name)
              : undefined,
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
  }

  app.post(PLUGINS_ADD_PATH, async (c) => {
    const installer = pluginInstaller(c.var.config);
    if (installer.state !== 'on') return refuse(c, INSTALLER_REFUSALS[installer.state]);
    const body = await c.req.parseBody();
    const name = field(body[PACKAGE_FIELD]).trim();
    const version = field(body[VERSION_FIELD]).trim();
    const typed = { package: name, version };
    const user = confirmedUser(c, field(body[PASSWORD_FIELD]));
    if (user === undefined) {
      return drawPluginsScreen(
        c,
        { ...typed, problems: { password: `${WRONG_PASSWORD} installed.` } },
        400,
      );
    }
    const spec = version === '' ? name : `${name}@${version}`;
    try {
      parsePackageSpec(spec);
    } catch (error) {
      return drawPluginsScreen(c, { ...typed, problems: { package: messageOf(error) } }, 400);
    }
    return await manage(c, installer.pluginsDir, user, (options) => installPlugin(options, spec));
  });

  app.post(PLUGINS_CHECK_PATH, async (c) => {
    const installer = pluginInstaller(c.var.config);
    if (installer.state !== 'on') return refuse(c, INSTALLER_REFUSALS[installer.state]);
    try {
      const report = await checkForUpdates(manageOptions(c, installer.pluginsDir));
      const available = report.plugins.filter((plugin) => plugin.status === 'available').length;
      flash(
        c,
        'notice',
        available === 0
          ? 'No plugin in the plugins folder has a newer version this site can run.'
          : `${available === 1 ? 'One plugin has' : `${String(available)} plugins have`} a newer version.`,
      );
    } catch (error) {
      flash(c, 'error', `Checking for updates failed: ${messageOf(error)}`);
    }
    return c.redirect(PLUGINS_PATH, 303);
  });

  app.get(PLUGINS_CONFIRM_PATH, async (c) => {
    const installer = pluginInstaller(c.var.config);
    if (installer.state !== 'on') return refuse(c, INSTALLER_REFUSALS[installer.state]);
    const action = c.req.query('action');
    if (!isConfirmable(action)) return c.notFound();
    return await drawConfirm(c, installer.pluginsDir, action, c.req.query(PLUGIN_FIELD) ?? '');
  });

  app.post(PLUGINS_UPDATE_PATH, async (c) => {
    return await confirmed(c, 'update', (options, name) => updatePlugins(options, [name]));
  });

  app.post(PLUGINS_UPDATE_ALL_PATH, async (c) => {
    return await confirmed(c, 'update-all', (options) => updatePlugins(options, undefined));
  });

  app.post(PLUGINS_REMOVE_PATH, async (c) => {
    return await confirmed(c, 'remove', (options, name) => deletePlugin(options, name));
  });

  async function confirmed(
    c: Context<GeekityEnv>,
    action: Confirmable,
    change: (options: ManageOptions, name: string) => Promise<ManageOutcome[]>,
  ): Promise<Response> {
    const installer = pluginInstaller(c.var.config);
    if (installer.state !== 'on') return refuse(c, INSTALLER_REFUSALS[installer.state]);
    const body = await c.req.parseBody();
    const name = field(body[PLUGIN_FIELD]);
    const user = confirmedUser(c, field(body[PASSWORD_FIELD]));
    if (user === undefined) {
      const verb = action === 'remove' ? 'removed' : 'updated';
      return await drawConfirm(c, installer.pluginsDir, action, name, `${WRONG_PASSWORD} ${verb}.`);
    }
    return await manage(c, installer.pluginsDir, user, (options) => change(options, name));
  }

  async function drawConfirm(
    c: Context<GeekityEnv>,
    pluginsDir: string,
    action: Confirmable,
    name: string,
    error?: string,
  ): Promise<Response> {
    let lines: string[];
    let ready: boolean;
    if (action === 'remove') {
      const folders = installedFolders(pluginsDir);
      const enabled = readEnabledPlugins(c.var.config.contentDir).has(name);
      ready = folders.has(name) && !enabled;
      const version = folders.get(name);
      lines = !folders.has(name)
        ? [`${name} is not in the plugins folder.`]
        : enabled
          ? [enabledRefusal(name)]
          : [
              `${name}${version === undefined ? '' : ` ${version}`} is deleted from the plugins folder. Its settings in site.json and its folder under data/plugins stay.`,
            ];
    } else {
      try {
        const report = await checkForUpdates(
          manageOptions(c, pluginsDir),
          action === 'update' ? [name] : undefined,
        );
        lines = report.plugins.map((plugin) => `${plugin.name}: ${describeUpgrade(plugin)}`);
        ready = report.plugins.some((plugin) => plugin.status === 'available');
      } catch (error) {
        lines = [`Checking for updates failed: ${messageOf(error)}`];
        ready = false;
      }
    }
    c.status(error === undefined ? 200 : 400);
    return render(c, ADMIN_TEMPLATES.pluginConfirm, {
      section: PLUGINS_SECTION,
      child: PLUGINS_CHILD,
      title: CONFIRM_TITLES[action],
      lines,
      ready,
      problems: error === undefined ? {} : { password: error },
      postUrl: CONFIRM_POSTS[action],
      field: PLUGIN_FIELD,
      plugin: action === 'update-all' ? undefined : name,
      passwordField: PASSWORD_FIELD,
      buttonLabel: CONFIRM_BUTTONS[action],
      danger: action === 'remove',
      backUrl: PLUGINS_PATH,
    });
  }

  async function manage(
    c: Context<GeekityEnv>,
    pluginsDir: string,
    user: string,
    change: (options: ManageOptions) => Promise<ManageOutcome[]>,
  ): Promise<Response> {
    try {
      const outcomes = await change({
        ...manageOptions(c, pluginsDir),
        contentDir: c.var.config.contentDir,
        dataDir: c.var.config.dataDir,
        user,
        next:
          c.var.supervision === undefined
            ? 'Restart the site to load the change.'
            : 'Press Reload to load the change.',
      });
      for (const outcome of outcomes) flash(c, outcome.kind, outcome.message);
    } catch (error) {
      flash(c, 'error', messageOf(error));
    }
    return c.redirect(PLUGINS_PATH, 303);
  }

  function confirmedUser(c: Context<GeekityEnv>, password: string): string | undefined {
    const userId = c.var.session?.userId;
    if (userId == null || password === '') return undefined;
    const user = findUserById(c.var.config.dataDir, userId);
    if (user === undefined) return undefined;
    return verifyUserPassword(c.var.config.dataDir, user.username, password)?.username;
  }

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

  app.post(PLUGINS_ENABLE_PATH, async (c) => {
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

  app.post(PLUGINS_DISABLE_PATH, async (c) => {
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

  app.get(`${PLUGINS_PATH}/*`, async (c, next) => {
    const name = screenName(c);
    if (name === undefined) return next();
    const found = screenedPlugin(c, name);
    if (found === undefined) return c.notFound();
    return drawScreen(c, found, {});
  });

  app.post(`${PLUGINS_PATH}/*`, async (c, next) => {
    const name = screenName(c);
    if (name === undefined) return next();
    const found = screenedPlugin(c, name);
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

  function screenedPlugin(c: Context<GeekityEnv>, name: string): RegisteredPlugin | undefined {
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

type PluginInstaller =
  | { readonly state: 'on'; readonly pluginsDir: string }
  | { readonly state: 'off' }
  | { readonly state: 'no-folder' };

function pluginInstaller(config: ResolvedConfig): PluginInstaller {
  if (config.pluginsDir === undefined) return { state: 'no-folder' };
  return config.pluginInstall ? { state: 'on', pluginsDir: config.pluginsDir } : { state: 'off' };
}

const INSTALLER_REFUSALS: Readonly<Record<'off' | 'no-folder', string>> = {
  off: 'Adding, updating and removing plugins from the admin is turned off on this site (GEEKITY_PLUGIN_INSTALL=off). Use geekity plugin on the command line instead.',
  'no-folder':
    'This site has no plugins folder (GEEKITY_PLUGINS_DIR), so plugins cannot be added from the admin.',
};

type Confirmable = 'update' | 'update-all' | 'remove';

interface AddProblems {
  package?: string;
  password?: string;
}

const CONFIRM_POSTS: Readonly<Record<Confirmable, string>> = {
  update: PLUGINS_UPDATE_PATH,
  'update-all': PLUGINS_UPDATE_ALL_PATH,
  remove: PLUGINS_REMOVE_PATH,
};

const CONFIRM_TITLES: Readonly<Record<Confirmable, string>> = {
  update: 'Update plugin',
  'update-all': 'Update all plugins',
  remove: 'Remove plugin',
};

const CONFIRM_BUTTONS: Readonly<Record<Confirmable, string>> = {
  update: 'Update',
  'update-all': 'Update all',
  remove: 'Remove',
};

function isConfirmable(action: string | undefined): action is Confirmable {
  return action !== undefined && Object.hasOwn(CONFIRM_POSTS, action);
}

function confirmPath(action: Confirmable, name?: string): string {
  const query = new URLSearchParams({ action });
  if (name !== undefined) query.set(PLUGIN_FIELD, name);
  return `${PLUGINS_CONFIRM_PATH}?${query.toString()}`;
}

const PACKAGE_FIELD = 'package';
const VERSION_FIELD = 'version';
const PASSWORD_FIELD = 'password';
const WRONG_PASSWORD = 'Your password was not right, so nothing was';

function manageOptions(c: Context<GeekityEnv>, pluginsDir: string) {
  return {
    pluginsDir,
    registry: pluginRegistry(process.env),
    coreVersion: ownManifest().version,
    configured: c.var.config.plugins.map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      peerDependencies: plugin.requires ?? {},
    })),
    now: c.var.config.now(),
  };
}

const CHANGE_WORDS: Readonly<Record<PluginChangeEntry['action'], string>> = {
  add: 'Added',
  update: 'Updated',
  remove: 'Removed',
};

function changeView(entry: PluginChangeEntry, timezone: string) {
  const versions =
    entry.action === 'remove'
      ? (entry.from ?? '')
      : entry.from === undefined || entry.from === entry.to
        ? entry.to
        : `${entry.from} to ${entry.to}`;
  return {
    when: formatInTimezone(entry.at, timezone),
    user: entry.user,
    action: CHANGE_WORDS[entry.action],
    name: entry.name,
    versions,
  };
}

function field(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
