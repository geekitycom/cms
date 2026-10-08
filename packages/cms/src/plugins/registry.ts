/**
 * The plugin registry (decision-33): every installed plugin, registered once
 * at boot, and what the dependency graph says about each.
 *
 * Installed and enabled are separate. Installed is fixed for the life of the
 * process: the plugins handed to `createCms`. Enabled is the `plugins` key of
 * `site.json`, read per request, so every question that depends on it takes
 * the enabled set as an argument rather than holding one.
 */

import { HOST_API_VERSION } from '../plugin.ts';
import type { Plugin, PluginHost, PluginRouteHandler } from '../plugin.ts';

/** A plugin as it arrived, and a description of where it came from. */
export interface InstalledPlugin {
  plugin: Plugin;
  /** Where it came from, as the Plugins screen and a boot error name it. */
  source: string;
}

/** One public route a plugin declared in `register`. */
export interface PluginRoute {
  path: string;
  handler: PluginRouteHandler;
}

/** An installed plugin after registration. */
export interface RegisteredPlugin extends InstalledPlugin {
  /** Why it cannot run, or `undefined` when it can be enabled. */
  problem: string | undefined;
  routes: readonly PluginRoute[];
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

/** npm's rule for a package name, scoped or not. */
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const PACKAGE_NAME_MAX = 214;

/**
 * Register every installed plugin and resolve the dependency graph. Throws
 * {@link DuplicatePluginError} when two plugins share a name; every other
 * problem leaves that plugin unavailable and the site booting.
 */
export function createPluginRegistry(installed: readonly InstalledPlugin[]): PluginRegistry {
  const bySource = new Map<string, InstalledPlugin>();
  for (const entry of installed) {
    const earlier = bySource.get(entry.plugin.name);
    if (earlier !== undefined) {
      throw new DuplicatePluginError(entry.plugin.name, earlier.source, entry.source);
    }
    bySource.set(entry.plugin.name, entry);
  }

  const own = new Map<string, string | undefined>();
  const routes = new Map<string, PluginRoute[]>();
  for (const entry of installed) {
    const declared: PluginRoute[] = [];
    routes.set(entry.plugin.name, declared);
    own.set(entry.plugin.name, register(entry.plugin, declared));
  }

  const cyclic = cyclicNames(installed.map((entry) => entry.plugin));
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
    const intrinsic = own.get(name);
    if (intrinsic !== undefined) return intrinsic;
    const cycle = cyclic.get(name);
    if (cycle !== undefined) return `It is in a dependency cycle: ${cycle.join(' → ')}.`;
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

  const plugins: RegisteredPlugin[] = installed.map((entry) => ({
    ...entry,
    problem: problem(entry.plugin.name),
    routes: routes.get(entry.plugin.name) ?? [],
  }));

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
          // Counted as started even when start throws, so the next request
          // does not try again, and stop still gets its chance to clean up.
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

/** Run a plugin's `register`, returning why it cannot run, if it cannot. */
function register(plugin: Plugin, routes: PluginRoute[]): string | undefined {
  const { name } = plugin;
  if (name.length > PACKAGE_NAME_MAX || !PACKAGE_NAME.test(name)) {
    return `${JSON.stringify(name)} is not an npm package name, which a plugin is named by.`;
  }
  if (!Number.isInteger(plugin.hostApi) || plugin.hostApi > HOST_API_VERSION) {
    return `It targets host API version ${String(plugin.hostApi)}, and this core provides version ${String(HOST_API_VERSION)}.`;
  }

  let registering = true;
  const host: PluginHost = {
    apiVersion: HOST_API_VERSION,
    name,
    get(path, handler) {
      if (!registering) throw new Error(`${name} declared a route after its register returned.`);
      routes.push({ path, handler });
    },
  };

  try {
    plugin.register(host);
    return undefined;
  } catch (error) {
    routes.length = 0;
    return `Its register failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    registering = false;
  }
}

async function lifecycle(plugin: Plugin, hook: 'start' | 'stop'): Promise<void> {
  try {
    await plugin[hook]?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`The ${plugin.name} plugin's ${hook} failed: ${message}`);
  }
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
