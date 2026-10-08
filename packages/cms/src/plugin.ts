/**
 * `@geekity/cms/plugin`: the whole of what a plugin may import from core
 * (decision-33). Types, the host API version and {@link definePlugin}, which is
 * an identity function so a bundled plugin needs no runtime import of core.
 *
 * Removing or reshaping anything here is a breaking change to `@geekity/cms`
 * (decision-6), and bumps {@link HOST_API_VERSION}.
 */

import type { webcrypto } from 'node:crypto';

import type { KvStore } from '@fedify/fedify';

/**
 * The version of the host API this core provides. A plugin names the version
 * it targets in {@link Plugin.hostApi}, and one that targets a newer version
 * than this is unavailable.
 */
export const HOST_API_VERSION = 1;

/**
 * The site federation's key-value store, as Fedify defines it. A plugin that
 * runs a federation of its own hands it this store, so the two agree about
 * which activities they have already handled.
 */
export type { KvStore };

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
 * A JSON-LD document as plain data. Documents cross the host boundary this way
 * rather than as objects built by a library, because a bundled plugin carries
 * its own copy of every library and an `instanceof` across two copies fails.
 */
export type JsonLdDocument = Readonly<Record<string, unknown>>;

/** One account on the site. */
export interface PluginUser {
  readonly username: string;
  /** The ActivityStreams id this person was published under elsewhere, if any. */
  readonly actorId?: string | undefined;
}

/** A follower, as a user's `followers.json` holds one. */
export interface PluginFollower {
  readonly actorId: string;
  readonly inboxId: string;
  readonly sharedInboxId: string | null;
  /** `@name@host`, or `null`. */
  readonly handle: string | null;
  readonly name: string | null;
  readonly iconUrl: string | null;
  readonly url: string | null;
}

/** The algorithms an actor holds a key pair for. */
export type PluginKeyAlgorithm = 'RSASSA-PKCS1-v1_5' | 'Ed25519';

/** One of a user's key files. */
export interface PluginActorKey {
  /** The file, absolute. */
  readonly file: string;
  /** The private JWK it holds, or `undefined` when there is no file yet. */
  readonly jwk: string | undefined;
}

/** The site's accounts, keys and followers, as a plugin may read and change them. */
export interface PluginSite {
  readonly baseUrl: string;
  /** Every account, in the users file's order. */
  users(): readonly PluginUser[];
  /**
   * Set the id a user was published under elsewhere. Returns whether anything
   * changed. Throws for a user the site does not have, or an id another user
   * already carries.
   */
  setActorId(username: string, actorId: string): Promise<boolean>;
  actorKey(username: string, algorithm: PluginKeyAlgorithm): PluginActorKey;
  /** Write a private JWK as the user's key for one algorithm. */
  writeActorKey(username: string, algorithm: PluginKeyAlgorithm, jwk: string): void;
  /**
   * Load every key pair the user signs with, minting any that is missing.
   * Throws when a key file does not import.
   */
  loadActorKeys(username: string): Promise<void>;
  followers(username: string): readonly PluginFollower[];
  /** Add a follower, or refresh the one already held. */
  addFollower(username: string, follower: PluginFollower): Promise<void>;
}

/** The plugin's private folder, `data/plugins/<package name>/`. */
export interface PluginDataFolder {
  /** The folder, absolute. */
  readonly path: string;
  /** A file's text, or `undefined` when it is not there. */
  read(file: string): string | undefined;
  /**
   * Read a file, decide what it says next and write it, as one step nothing
   * else writing that file can get between. The write is atomic.
   */
  update(file: string, change: (current: string | undefined) => string): Promise<void>;
}

/** One page of a collection the site's federation publishes. */
export interface PluginCollectionPage<Item> {
  readonly items: readonly Item[];
  readonly nextCursor: string | null;
  readonly prevCursor: string | null;
}

/** A collection the site's federation publishes, paged by offset cursors. */
export interface PluginCollection<Item> {
  readonly totalItems: number;
  readonly firstCursor: string;
  readonly lastCursor: string;
  /** One page; a `null` cursor is every item at once. */
  page(cursor: string | null): Promise<PluginCollectionPage<Item>>;
}

/** A follower as a delivery reaches them. */
export interface PluginRecipient {
  readonly id: string;
  readonly inboxId: string;
  readonly sharedInboxId: string | null;
}

/** What a federation middleware is handed for one request. */
export interface PluginFederationContext {
  readonly request: Request;
  readonly site: PluginSite;
  /** The site federation's store, for idempotence shared with its inboxes. */
  readonly kv: KvStore;
  /** Whether the site's federation may fetch from private addresses. */
  readonly allowPrivateAddress: boolean;
  /** The site's clock. */
  now(): Date;
  /** A user's actor document, exactly as the site's federation serves it. */
  actor(username: string): Promise<JsonLdDocument | undefined>;
  /**
   * The key pairs a user signs with, as WebCrypto keys, which belong to no
   * library. Empty for a user the site does not have.
   */
  keyPairs(username: string): Promise<webcrypto.CryptoKeyPair[]>;
  /**
   * A user's outbox, the activities announcing their posts, or `undefined`
   * for a user the site does not have.
   */
  outbox(username: string): PluginCollection<JsonLdDocument> | undefined;
  /** A user's followers, or `undefined` for a user the site does not have. */
  followers(username: string): PluginCollection<PluginRecipient> | undefined;
  /**
   * Handle an activity a plugin's inbox verified, as the site's own inbox
   * handles it. `recipient` is the username of the personal inbox it arrived
   * at, or `null` for a shared inbox.
   */
  receive(activity: JsonLdDocument, recipient: string | null): Promise<void>;
}

/**
 * Answers a request in the federation mount, or hands it on with `next`, which
 * resolves to what the rest of the site answers.
 */
export type PluginFederationMiddleware = (
  context: PluginFederationContext,
  next: () => Promise<Response>,
) => Promise<Response>;

/** Text on a plugin screen: plain, or set as code. */
export type PluginScreenText = string | { readonly code: string };

/** A table cell: text, or an instant drawn as a date, `null` for never. */
export type PluginScreenCell = PluginScreenText | { readonly time: string | null };

/** One block of a plugin screen's card. */
export type PluginScreenBlock =
  | { readonly paragraph: readonly PluginScreenText[] }
  | {
      readonly table: {
        readonly caption: string;
        readonly columns: readonly string[];
        readonly rows: readonly (readonly PluginScreenCell[])[];
      };
    };

/** One card on a plugin screen. */
export interface PluginScreenCard {
  readonly title: string;
  readonly blocks: readonly PluginScreenBlock[];
}

/** What a plugin screen's render is handed. */
export interface PluginScreenContext {
  readonly site: PluginSite;
}

/**
 * A screen under Plugins in the admin, listed in the menu while the plugin is
 * active. Core draws it, so a plugin writes no markup.
 */
export interface PluginScreen {
  /** Its heading and its label in the menu. */
  readonly title: string;
  render(context: PluginScreenContext): readonly PluginScreenCard[];
}

/** One option a command takes. */
export interface PluginCommandOption {
  /** Its name without the dashes. */
  readonly name: string;
  /** What its value is called in the help, or absent for an on-off switch. */
  readonly value?: string | undefined;
  readonly description: string;
}

/** What a command's run is handed. */
export interface PluginCommandContext {
  /** The arguments after the command's words. */
  readonly args: readonly string[];
  /** Each option given: the text after it, or `true` for a switch. */
  readonly options: Readonly<Record<string, string | true>>;
  /** The directory the command was run from. */
  readonly cwd: string;
  readonly site: PluginSite;
  /** Write to standard output. */
  write(text: string): void;
}

/** A command on the `geekity` command line. */
export interface PluginCommand {
  /** The words that name it, such as `['import', 'old-blog']`. */
  readonly words: readonly string[];
  /** What follows the words in the usage line, such as `<username> --id <n>`. */
  readonly usage: string;
  /** What `geekity --help` says it does. */
  readonly summary: string;
  /** Every option it takes; any other is refused. */
  readonly options?: readonly PluginCommandOption[] | undefined;
  /** Run it and answer the exit code. A thrown error is printed and exits 1. */
  run(context: PluginCommandContext): number | Promise<number>;
}

/**
 * A plugin's only door into the CMS, handed to {@link Plugin.register}. It
 * reaches no other plugin: registration order never matters. Everything is
 * declared during `register`; a declaration after it returns throws.
 */
export interface PluginHost {
  /** {@link HOST_API_VERSION} of the core running the plugin. */
  readonly apiVersion: number;
  /** The name of the plugin this host belongs to. */
  readonly name: string;
  /** The plugin's private folder under `data/`. */
  readonly data: PluginDataFolder;
  /**
   * Answer `GET` (and `HEAD`) on a public path, in Hono's path syntax. The
   * route answers only while the plugin is enabled; otherwise the request
   * falls through as if the route were absent.
   */
  get(path: string, handler: PluginRouteHandler): void;
  /**
   * Run a middleware in the federation mount, after the site's own federation
   * has answered its paths and before stored ids are. It runs only while the
   * plugin is enabled.
   */
  federation(middleware: PluginFederationMiddleware): void;
  /** Add the plugin's screen under Plugins. At most one per plugin. */
  screen(screen: PluginScreen): void;
  /**
   * Add a command to the command line. It runs whenever the plugin is
   * installed and available, enabled or not.
   */
  command(command: PluginCommand): void;
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
