/**
 * `@geekity/cms/plugin`: the whole of what a plugin may import from core
 * (decision-33). Types, the host API version and {@link definePlugin}, which is
 * an identity function so a bundled plugin needs no runtime import of core.
 *
 * Removing or reshaping anything here is a breaking change to `@geekity/cms`
 * (decision-6), and bumps {@link HOST_API_VERSION}.
 */

/**
 * The version of the host API this core provides. A plugin names the version
 * it targets in {@link Plugin.hostApi}, and one that targets a newer version
 * than this is unavailable.
 */
export const HOST_API_VERSION = 1;

/** What a plugin's route handler is handed. */
export interface PluginRequestContext {
  /** The request as it arrived. */
  readonly request: Request;
  /** The named parameters of the route's path, such as `:slug`. */
  readonly params: Readonly<Record<string, string>>;
}

/** Answers one request to a plugin's route. */
export type PluginRouteHandler = (context: PluginRequestContext) => Response | Promise<Response>;

/**
 * A plugin's only door into the CMS, handed to {@link Plugin.register}. It
 * reaches no other plugin: registration order never matters.
 */
export interface PluginHost {
  /** {@link HOST_API_VERSION} of the core running the plugin. */
  readonly apiVersion: number;
  /** The name of the plugin this host belongs to. */
  readonly name: string;
  /**
   * Answer `GET` (and `HEAD`) on a public path, in Hono's path syntax. The
   * route answers only while the plugin is enabled; otherwise the request
   * falls through as if the route were absent.
   */
  get(path: string, handler: PluginRouteHandler): void;
}

/**
 * The plugins this one depends on: package name to the semver range it
 * needs, the same pairs as its peer dependencies.
 */
export type PluginRequirements = Readonly<Record<string, string>>;

/** A plugin, as a site config or a bundle's default export hands it over. */
export interface Plugin {
  /**
   * The npm package name, such as `@geekity/plugin-llm`. A plugin installed by
   * hand still declares a package-style name. It is the key of the plugin
   * everywhere: `requires`, the `plugins` key in `site.json` and its data.
   */
  readonly name: string;
  /** The package version, shown on the Plugins screen. */
  readonly version: string;
  /** What the Plugins screen calls it. */
  readonly label: string;
  /** One or two sentences on what it does. */
  readonly description: string;
  /** The {@link HOST_API_VERSION} it was written against. */
  readonly hostApi: number;
  /** The plugins it needs installed and enabled before it can be enabled. */
  readonly requires?: PluginRequirements;
  /**
   * Called once at boot for every installed plugin, enabled or not, to
   * declare what the plugin contributes.
   */
  register(host: PluginHost): void;
  /** Called when the plugin starts running: at boot when enabled, and on enable. */
  start?(): void | Promise<void>;
  /** Called when it stops: on disable and when the CMS closes. */
  stop?(): void | Promise<void>;
}

/** Declare a plugin, typed. Returns it unchanged. */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
