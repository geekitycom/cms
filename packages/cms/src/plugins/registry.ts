/**
 * The plugin registry (decision-33): every installed plugin, registered once
 * at boot, and what the dependency graph says about each.
 *
 * Installed and enabled are separate. Installed is fixed for the life of the
 * process: the plugins handed to `createCms`. Enabled is the `plugins` key of
 * `site.json`, read per request, so every question that depends on it takes
 * the enabled set as an argument rather than holding one.
 */

import { createRequire } from 'node:module';
import path from 'node:path';

import semver from 'semver';

import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import { HOST_API_VERSION } from '../plugin.ts';
import type {
  Plugin,
  PluginCommand,
  PluginDataFolder,
  PluginEditorAction,
  PluginFederationMiddleware,
  PluginHost,
  PluginRouteHandler,
  PluginScreen,
  PluginSettingField,
  PluginSettings,
  PluginService,
  PluginSettingValues,
  PluginSiteInfo,
} from '../plugin.ts';
import { pluginFetch } from './fetch.ts';
import type { PluginFetchOptions } from './fetch.ts';
import {
  pluginEnvPrefix,
  pluginFolderPath,
  resolvePluginSettings,
  settingFieldsProblem,
  settingValues,
} from './settings.ts';
import type { PluginSettingsPlace } from './settings.ts';

/** A plugin as it arrived, and a description of where it came from. */
export interface InstalledPlugin {
  plugin: Plugin;
  /** Where it came from, as the Plugins screen and a boot error name it. */
  source: string;
  /**
   * Why it could not be loaded, such as a folder whose module failed to
   * import. Such a plugin is never registered, and `plugin` only names it.
   */
  problem?: string | undefined;
  /**
   * The ranges a folder install's `plugin.json` names, of `@geekity/cms` and
   * of each plugin it requires. npm checks them for a package it installs.
   */
  peerDependencies?: Readonly<Record<string, string>> | undefined;
}

/** One public route a plugin declared in `register`. */
export interface PluginRoute {
  path: string;
  handler: PluginRouteHandler;
}

/** What a plugin declared in `register`. */
export interface PluginContributions {
  routes: readonly PluginRoute[];
  federation: readonly PluginFederationMiddleware[];
  screen: PluginScreen | undefined;
  commands: readonly PluginCommand[];
  /** The settings fields it declared, empty when it has none. */
  settings: readonly PluginSettingField[];
  /** Its buttons beside editor fields, in the order it declared them. */
  editorActions: readonly PluginEditorAction[];
}

/**
 * What plugins read through the registry: the site's folders, its
 * environment, its base URL and title, and which addresses they may fetch.
 */
export interface PluginRegistryOptions extends PluginFetchOptions {
  dataDir: string;
  contentDir: string;
  env: Readonly<Record<string, string | undefined>>;
  siteInfo(): PluginSiteInfo;
}

/** An installed plugin after registration. */
export interface RegisteredPlugin extends InstalledPlugin, PluginContributions {
  /** Why it cannot run, or `undefined` when it can be enabled. */
  problem: string | undefined;
  /** Where its settings are read from and written to. */
  settingsPlace: PluginSettingsPlace;
}

/**
 * Where one requirement of a plugin stands. `blocked` is a plugin that is
 * enabled but cannot run, because something it requires is not running.
 */
export type RequirementState = 'enabled' | 'blocked' | 'disabled' | 'unavailable' | 'missing';

export interface Requirement {
  name: string;
  range: string;
  state: RequirementState;
}

export interface PluginRegistry {
  /** Every installed plugin, in the order it was installed. */
  readonly plugins: readonly RegisteredPlugin[];
  find(name: string): RegisteredPlugin | undefined;
  /** Why the plugin cannot run, or `undefined`. */
  problem(name: string): string | undefined;
  /**
   * The plugins that run under this enabled set: enabled, available, and
   * with everything they require running.
   */
  active(enabled: ReadonlySet<string>): ReadonlySet<string>;
  /** Each plugin this one requires, and where it stands. */
  requirements(name: string, enabled: ReadonlySet<string>): Requirement[];
  /** The enabled plugins that require this one. */
  enabledDependents(name: string, enabled: ReadonlySet<string>): string[];
  /**
   * Start the plugins that should run and stop the ones that should not, so
   * the running set is {@link PluginRegistry.active}. Safe to call on every
   * request: when nothing changed it does nothing. Calls are serialized.
   */
  reconcile(enabled: ReadonlySet<string>): Promise<void>;
  /** Stop every running plugin, dependents first. Nothing starts after. */
  close(): Promise<void>;
}

/** Two installed plugins with one name. */
export class DuplicatePluginError extends Error {
  constructor(name: string, first: string, second: string) {
    super(`Two plugins are named ${name}: one from ${first} and one from ${second}.`);
    this.name = 'DuplicatePluginError';
  }
}

const CORE_PACKAGE = '@geekity/cms';
const CORE_VERSION = (createRequire(import.meta.url)('../../package.json') as { version: string })
  .version;

/** npm's rule for a package name, scoped or not. */
export const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const PACKAGE_NAME_MAX = 214;

/**
 * Register every installed plugin and resolve the dependency graph. Throws
 * {@link DuplicatePluginError} when two plugins share a name; every other
 * problem leaves that plugin unavailable and the site booting.
 */
export function createPluginRegistry(
  installed: readonly InstalledPlugin[],
  options: PluginRegistryOptions,
): PluginRegistry {
  const bySource = new Map<string, InstalledPlugin>();
  for (const entry of installed) {
    const earlier = bySource.get(entry.plugin.name);
    if (earlier !== undefined) {
      throw new DuplicatePluginError(entry.plugin.name, earlier.source, entry.source);
    }
    bySource.set(entry.plugin.name, entry);
  }

  const own = new Map<string, string | undefined>();
  const contributions = new Map<string, PluginContributions>();
  const services = new Map<string, unknown>();
  let registered = false;

  const serviceFor = (consumer: Plugin, dependency: string): unknown => {
    if (!Object.hasOwn(consumer.requires ?? {}, dependency)) {
      throw new Error(`${consumer.name} uses ${dependency}, which is not in its requires.`);
    }
    if (!registered) {
      throw new Error(
        `${consumer.name} called use(${JSON.stringify(dependency)}) in its register. Call it when handling a request, a command or a job, once every plugin has registered.`,
      );
    }
    if (!services.has(dependency)) throw new Error(`${dependency} provides no service.`);
    return services.get(dependency);
  };

  for (const entry of installed) {
    const { problem, declared, service } =
      entry.problem === undefined
        ? register(entry.plugin, options, serviceFor)
        : { problem: entry.problem, declared: NOTHING_DECLARED, service: undefined };
    own.set(entry.plugin.name, problem);
    contributions.set(entry.plugin.name, declared);
    if (service !== undefined) services.set(entry.plugin.name, service.value);
  }
  registered = true;

  const cyclic = cyclicNames(installed.map((entry) => entry.plugin));
  const sharedPrefixes = prefixCollisions(installed.map((entry) => entry.plugin.name));
  const problems = new Map<string, string | undefined>();

  function problem(name: string): string | undefined {
    if (problems.has(name)) return problems.get(name);
    const found = resolveProblem(name);
    problems.set(name, found);
    return found;
  }

  function resolveProblem(name: string): string | undefined {
    const entry = bySource.get(name);
    if (entry === undefined) return 'It is not installed.';
    const shared = sharedPrefixes.get(name);
    if (shared !== undefined) {
      return `Its environment variables would start ${pluginEnvPrefix(name)}__, as those of ${shared.join(' and ')} would, so none of them loads. Rename one package.`;
    }
    const intrinsic = own.get(name);
    if (intrinsic !== undefined) return intrinsic;
    const cycle = cyclic.get(name);
    if (cycle !== undefined) return `It is in a dependency cycle: ${cycle.join(' → ')}.`;
    for (const [dependency, range] of Object.entries(entry.peerDependencies ?? {})) {
      const version =
        dependency === CORE_PACKAGE ? CORE_VERSION : bySource.get(dependency)?.plugin.version;
      if (version === undefined || semver.satisfies(version, range)) continue;
      return dependency === CORE_PACKAGE
        ? `It needs ${CORE_PACKAGE} ${range}, and this core is ${version}.`
        : `It needs ${dependency} ${range}, and ${version} is installed.`;
    }
    for (const [dependency, range] of requirementsOf(entry.plugin)) {
      if (!bySource.has(dependency)) {
        return `It requires ${dependency} ${range}, which is not installed.`;
      }
      if (problem(dependency) !== undefined) {
        return `It requires ${dependency} ${range}, which is unavailable.`;
      }
    }
    return undefined;
  }

  const plugins: RegisteredPlugin[] = installed.map((entry) => {
    const declared = contributions.get(entry.plugin.name) ?? NOTHING_DECLARED;
    return {
      ...entry,
      ...declared,
      problem: problem(entry.plugin.name),
      settingsPlace: { ...options, name: entry.plugin.name, fields: declared.settings },
    };
  });

  const order = dependencyOrder(plugins.filter((entry) => entry.problem === undefined));

  function active(enabled: ReadonlySet<string>): ReadonlySet<string> {
    const running = new Set<string>();
    for (const entry of order) {
      const { name } = entry.plugin;
      if (!enabled.has(name)) continue;
      if (requirementsOf(entry.plugin).every(([dependency]) => running.has(dependency))) {
        running.add(name);
      }
    }
    return running;
  }

  const started: Plugin[] = [];
  let closed = false;
  let queue: Promise<void> = Promise.resolve();

  function serialized(step: () => Promise<void>): Promise<void> {
    queue = queue.then(step);
    return queue;
  }

  async function stopFrom(shouldStop: (name: string) => boolean): Promise<void> {
    for (const entry of [...started].reverse()) {
      if (!shouldStop(entry.name)) continue;
      started.splice(started.indexOf(entry), 1);
      await lifecycle(entry, 'stop');
    }
  }

  return {
    plugins,
    find: (name) => plugins.find((entry) => entry.plugin.name === name),
    problem,
    active,

    requirements(name, enabled) {
      const entry = bySource.get(name);
      if (entry === undefined) return [];
      const running = active(enabled);
      return requirementsOf(entry.plugin).map(([dependency, range]) => ({
        name: dependency,
        range,
        state: requirementState(dependency, enabled, running),
      }));
    },

    enabledDependents(name, enabled) {
      return plugins
        .filter((entry) => enabled.has(entry.plugin.name))
        .filter((entry) => requirementsOf(entry.plugin).some(([dependency]) => dependency === name))
        .map((entry) => entry.plugin.name);
    },

    reconcile(enabled) {
      return serialized(async () => {
        if (closed) return;
        const running = active(enabled);
        await stopFrom((name) => !running.has(name));
        for (const entry of order) {
          const { plugin } = entry;
          if (!running.has(plugin.name) || started.includes(plugin)) continue;
          started.push(plugin);
          await lifecycle(plugin, 'start');
        }
      });
    },

    close() {
      return serialized(async () => {
        closed = true;
        await stopFrom(() => true);
      });
    },
  };

  function requirementState(
    dependency: string,
    enabled: ReadonlySet<string>,
    running: ReadonlySet<string>,
  ): RequirementState {
    if (!bySource.has(dependency)) return 'missing';
    if (problem(dependency) !== undefined) return 'unavailable';
    if (running.has(dependency)) return 'enabled';
    return enabled.has(dependency) ? 'blocked' : 'disabled';
  }
}

const NOTHING_DECLARED: PluginContributions = {
  routes: [],
  federation: [],
  screen: undefined,
  commands: [],
  settings: [],
  editorActions: [],
};

/** What a plugin handed to `host.provide`, boxed so that providing `undefined` still counts. */
interface ProvidedService {
  readonly value: unknown;
}

interface Registration {
  problem: string | undefined;
  declared: PluginContributions;
  service?: ProvidedService | undefined;
}

/**
 * Run a plugin's `register`, returning why it cannot run, if it cannot, what
 * it declared and the service it provided. A plugin whose register fails
 * declares and provides nothing.
 */
function register(
  plugin: Plugin,
  options: PluginRegistryOptions,
  serviceFor: (consumer: Plugin, dependency: string) => unknown,
): Registration {
  const { name } = plugin;
  if (name.length > PACKAGE_NAME_MAX || !PACKAGE_NAME.test(name)) {
    return {
      problem: `${JSON.stringify(name)} is not an npm package name, which a plugin is named by.`,
      declared: NOTHING_DECLARED,
    };
  }
  if (!Number.isInteger(plugin.hostApi) || plugin.hostApi > HOST_API_VERSION) {
    return {
      problem: `It targets host API version ${String(plugin.hostApi)}, and this core provides version ${String(HOST_API_VERSION)}.`,
      declared: NOTHING_DECLARED,
    };
  }

  const routes: PluginRoute[] = [];
  const federation: PluginFederationMiddleware[] = [];
  const commands: PluginCommand[] = [];
  const editorActions: PluginEditorAction[] = [];
  let screen: PluginScreen | undefined;
  let settings: readonly PluginSettingField[] | undefined;
  let service: ProvidedService | undefined;
  let registering = true;

  function declaring(what: string): void {
    if (!registering) throw new Error(`${name} declared ${what} after its register returned.`);
  }

  const host: PluginHost = {
    apiVersion: HOST_API_VERSION,
    name,
    data: pluginDataFolder(options.dataDir, name),
    get(path, handler) {
      declaring('a route');
      routes.push({ path, handler });
    },
    federation(middleware) {
      declaring('a federation middleware');
      federation.push(middleware);
    },
    screen(declared) {
      declaring('a screen');
      if (screen !== undefined) throw new Error('A plugin has at most one screen.');
      screen = declared;
    },
    command(declared) {
      declaring('a command');
      commands.push(declared);
    },
    editorAction(declared) {
      declaring('an editor action');
      if (!EDITOR_ACTION_ID.test(declared.id)) {
        throw new Error(
          `${JSON.stringify(declared.id)} is not an editor action id: use lower case words joined by -.`,
        );
      }
      if (editorActions.some((entry) => entry.id === declared.id)) {
        throw new Error(
          `${name} declares two editor actions with the id ${JSON.stringify(declared.id)}.`,
        );
      }
      editorActions.push(declared);
    },
    siteInfo: () => options.siteInfo(),
    fetch: (url, init = {}) => pluginFetch(url, init, options),
    provide(value) {
      declaring('a service');
      if (service !== undefined) {
        throw new Error(
          `${name} provides a second service. A plugin provides at most one, named by its package name.`,
        );
      }
      service = { value };
    },
    use: <Dependency extends string>(dependency: Dependency) =>
      serviceFor(plugin, dependency) as PluginService<Dependency>,
    settings<const Fields extends readonly PluginSettingField[]>(
      fields: Fields,
    ): PluginSettings<Fields> {
      declaring('its settings');
      if (settings !== undefined) throw new Error('A plugin declares its settings once.');
      const problem = settingFieldsProblem(fields);
      if (problem !== undefined) throw new Error(problem);
      settings = fields;
      const place = { ...options, name, fields };
      return {
        // Each value is built from its field's type, which is what the mapped
        // type says, but TypeScript cannot follow a map over the fields.
        current: () => settingValues(resolvePluginSettings(place)) as PluginSettingValues<Fields>,
      };
    },
  };

  try {
    plugin.register(host);
    return {
      problem: undefined,
      declared: { routes, federation, screen, commands, settings: settings ?? [], editorActions },
      service,
    };
  } catch (error) {
    return {
      problem: `Its register failed: ${error instanceof Error ? error.message : String(error)}`,
      declared: NOTHING_DECLARED,
    };
  } finally {
    registering = false;
  }
}

/** An editor action's id, which is the last segment of its endpoint's path. */
const EDITOR_ACTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A file name a plugin may use in its folder: one segment, not hidden. */
const DATA_FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** `data/plugins/<package name>/`, which only its plugin reads and writes. */
export function pluginDataFolder(dataDir: string, name: string): PluginDataFolder {
  const folder = pluginFolderPath(dataDir, name);

  function fileIn(file: string): string {
    if (!DATA_FILE_NAME.test(file)) {
      throw new Error(`${JSON.stringify(file)} is not a file name a plugin can use in its folder.`);
    }
    return path.join(folder, file);
  }

  return {
    path: folder,
    read: (file) => readFileIfPresentSync(fileIn(file)),
    update: (file, change) => updateFileAtomically(fileIn(file), change),
  };
}

async function lifecycle(plugin: Plugin, hook: 'start' | 'stop'): Promise<void> {
  try {
    await plugin[hook]?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`The ${plugin.name} plugin's ${hook} failed: ${message}`);
  }
}

/**
 * Each installed name whose environment variable prefix another installed
 * name shares, with those others: `@a/b-c` and `@a-b/c` both make `A_B_C`.
 */
function prefixCollisions(names: readonly string[]): Map<string, string[]> {
  const byPrefix = new Map<string, string[]>();
  for (const name of names) {
    const prefix = pluginEnvPrefix(name);
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), name]);
  }
  const collisions = new Map<string, string[]>();
  for (const group of byPrefix.values()) {
    if (group.length < 2) continue;
    for (const name of group)
      collisions.set(
        name,
        group.filter((other) => other !== name),
      );
  }
  return collisions;
}

function requirementsOf(plugin: Plugin): [string, string][] {
  return Object.entries(plugin.requires ?? {});
}

/**
 * Each plugin that sits in a dependency cycle, with the cycle it is in, found
 * as the strongly connected components (Tarjan) of the installed graph.
 */
function cyclicNames(plugins: readonly Plugin[]): Map<string, string[]> {
  const installed = new Map(plugins.map((plugin) => [plugin.name, plugin]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cyclic = new Map<string, string[]>();
  let next = 0;

  function visit(name: string): void {
    index.set(name, next);
    low.set(name, next);
    next += 1;
    stack.push(name);
    onStack.add(name);

    const plugin = installed.get(name);
    for (const [dependency] of plugin === undefined ? [] : requirementsOf(plugin)) {
      if (!installed.has(dependency)) continue;
      if (!index.has(dependency)) {
        visit(dependency);
        low.set(name, Math.min(low.get(name) ?? 0, low.get(dependency) ?? 0));
      } else if (onStack.has(dependency)) {
        low.set(name, Math.min(low.get(name) ?? 0, index.get(dependency) ?? 0));
      }
    }

    if (low.get(name) !== index.get(name)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== name);

    const selfLoop = Object.hasOwn(plugin?.requires ?? {}, name);
    if (component.length > 1 || selfLoop) {
      const cycle = [...component.reverse(), component[0] ?? name];
      for (const entry of component) cyclic.set(entry, cycle);
    }
  }

  for (const plugin of plugins) if (!index.has(plugin.name)) visit(plugin.name);
  return cyclic;
}

/**
 * Available plugins with every plugin before the ones that require it. Every
 * requirement of an available plugin is available, so this is a plain
 * depth-first post-order.
 */
function dependencyOrder(available: readonly RegisteredPlugin[]): RegisteredPlugin[] {
  const byName = new Map(available.map((entry) => [entry.plugin.name, entry]));
  const ordered: RegisteredPlugin[] = [];
  const seen = new Set<string>();

  function visit(entry: RegisteredPlugin): void {
    if (seen.has(entry.plugin.name)) return;
    seen.add(entry.plugin.name);
    for (const [dependency] of requirementsOf(entry.plugin)) {
      const required = byName.get(dependency);
      if (required !== undefined) visit(required);
    }
    ordered.push(entry);
  }

  for (const entry of available) visit(entry);
  return ordered;
}
