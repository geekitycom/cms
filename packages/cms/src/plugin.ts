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
 *
 * It is the gate that marks a break for plugins. A plugin accepts every core
 * from the one it was built against up to 1.0, so a core minor release does
 * not stop a plugin by itself. Raise this number in the release that changes
 * this module so a plugin written for the current version would fail on the
 * new core: a type, method or field removed or renamed, an argument or return
 * value reshaped, or a behavior a plugin relies on changed. Adding a method, an
 * optional field or a new extension point keeps the number.
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

/** What a plugin screen's render and its actions are handed. */
export interface PluginScreenContext {
  readonly site: PluginSite;
}

/** What an action reports, which the screen shows as a notice or an error. */
export interface PluginScreenOutcome {
  readonly ok: boolean;
  /** Plain words. Core shows them escaped. */
  readonly message: string;
}

/** A button on a plugin's screen, such as Test connection. */
export interface PluginScreenAction {
  /** Lower case words joined by `-`, unique on the screen. */
  readonly id: string;
  readonly label: string;
  run(context: PluginScreenContext): PluginScreenOutcome | Promise<PluginScreenOutcome>;
}

/**
 * A screen under Plugins in the admin, listed in the menu while the plugin is
 * active. Core draws it, so a plugin writes no markup.
 */
export interface PluginScreen {
  /** Its heading and its label in the menu. */
  readonly title: string;
  render(context: PluginScreenContext): readonly PluginScreenCard[];
  /** Buttons core draws under the settings, each run when pressed. */
  readonly actions?: readonly PluginScreenAction[] | undefined;
}

/** What every settings field has. */
interface PluginSettingBase {
  /**
   * Lower case words joined by `_`, such as `api_key`. It is the key in
   * `site.json` or `secrets.json`, and upper-cased it ends the field's
   * environment variable.
   */
  readonly key: string;
  readonly label: string;
  /** A sentence under the box. */
  readonly hint?: string | undefined;
}

/** A line of text. An empty box stores nothing, so the default applies. */
export interface PluginTextSetting extends PluginSettingBase {
  readonly type: 'text';
  readonly default?: string | undefined;
}

/** An absolute `http:` or `https:` URL. */
export interface PluginUrlSetting extends PluginSettingBase {
  readonly type: 'url';
  readonly default?: string | undefined;
}

/** One of a fixed list. */
export interface PluginSelectSetting extends PluginSettingBase {
  readonly type: 'select';
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly default: string;
}

/** On or off, off unless a default says otherwise. */
export interface PluginCheckboxSetting extends PluginSettingBase {
  readonly type: 'checkbox';
  readonly default?: boolean | undefined;
}

/**
 * A credential. It is kept in `secrets.json` in the plugin's data folder at
 * mode 0600, or set by an environment variable, and is never drawn on a page.
 */
export interface PluginSecretSetting extends PluginSettingBase {
  readonly type: 'secret';
}

/** One field of a plugin's settings form. */
export type PluginSettingField =
  | PluginTextSetting
  | PluginUrlSetting
  | PluginSelectSetting
  | PluginCheckboxSetting
  | PluginSecretSetting;

/** What one field hands the plugin: a secret may be unset, the rest always have a value. */
export type PluginSettingValue<Field extends PluginSettingField> =
  Field extends PluginCheckboxSetting
    ? boolean
    : Field extends PluginSecretSetting
      ? string | undefined
      : Field extends PluginSelectSetting
        ? Field['options'][number]['value']
        : string;

/** Every field's value, keyed by its key. */
export type PluginSettingValues<Fields extends readonly PluginSettingField[]> = {
  readonly [Field in Fields[number] as Field['key']]: PluginSettingValue<Field>;
};

/** A plugin's settings, as {@link PluginHost.settings} hands them back. */
export interface PluginSettings<Fields extends readonly PluginSettingField[]> {
  /**
   * The values now, read from the files and the environment on every call. A
   * stored value the field does not accept is replaced by the field's default.
   */
  current(): PluginSettingValues<Fields>;
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
 * The service each plugin provides, keyed by its package name. Empty here: a
 * plugin package that provides one adds its entry by declaration merging, and
 * a consumer that imports the package's types sees it.
 *
 * ```ts
 * declare module '@geekity/cms/plugin' {
 *   interface PluginServices {
 *     '@acme/plugin-clock': Clock;
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- providers fill it by declaration merging.
export interface PluginServices {}

/** The service a package provides, as {@link PluginServices} says, or `unknown` when it says nothing. */
export type PluginService<Name extends string> = Name extends keyof PluginServices
  ? PluginServices[Name]
  : unknown;

/** A field of the post and page editor that a plugin's button can sit beside. */
export type PluginEditorField = 'title' | 'description' | 'tags';

/**
 * What kind of post a draft is, by Post Type Discovery over what the editor
 * holds: a post with a `like-of` is a `like`, one with photos a `photo`, an
 * untitled one a `note` and a titled one an `article`.
 */
export type PluginPostType =
  | 'event'
  | 'rsvp'
  | 'repost'
  | 'like'
  | 'reply'
  | 'photo'
  | 'read'
  | 'bookmark'
  | 'note'
  | 'article';

/** The document in the editor as it stands when a button is pressed, saved or not. */
export interface PluginEditorDraft {
  readonly type: 'post' | 'page';
  /** A post's kind, or `undefined` for a page. */
  readonly postType: PluginPostType | undefined;
  /** Whether the document is on disk, rather than new in the editor. */
  readonly saved: boolean;
  readonly title: string;
  /** The Markdown body. */
  readonly body: string;
  readonly description: string;
  readonly tags: readonly string[];
  /** The language it is written in: its own `lang`, else the site's. */
  readonly lang: string;
}

/** What a press of an editor button hands its plugin. */
export interface PluginEditorContext {
  readonly draft: PluginEditorDraft;
  /** Every tag on the site's published documents, as written, most used first. */
  readonly siteTags: readonly string[];
  /**
   * The titles of the site's latest published posts that have one, newest
   * first, at most ten, leaving out any the draft's own title repeats.
   */
  readonly recentTitles: readonly string[];
  /** Aborts when the author leaves the page before the answer comes. */
  readonly signal: AbortSignal;
}

/** One of several values an editor button offers, each drawn with a box to tick. */
export interface PluginEditorChoice {
  readonly value: string;
  /** A few words after it, such as `120 followers`. */
  readonly note?: string | undefined;
  /** A word or two drawn as a badge, such as `Used here`. */
  readonly badge?: string | undefined;
  /**
   * The heading the choice is listed under, such as `For reach`. The editor
   * draws the heading before a choice whose group differs from the one before
   * it, so a plugin lists each group's choices together.
   */
  readonly group?: string | undefined;
}

/**
 * What an editor button answers: a value the author may accept into the
 * field, choices the author ticks before accepting, or why there is none, in
 * plain words. Core shows each escaped. Choices are for the tags field, and
 * accepting adds every ticked one; beside another field they are a failure.
 */
export type PluginEditorSuggestion =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: true; readonly choices: readonly PluginEditorChoice[] }
  | { readonly ok: false; readonly message: string };

/**
 * A button beside an editor field. Core draws it, posts the draft to the
 * plugin when it is pressed, and shows the suggestion with Accept and
 * Dismiss. Accepting fills the field and saves nothing; nothing is sent
 * unless the author presses the button. Without JavaScript there is no
 * button.
 */
export interface PluginEditorAction {
  /** Lower case words joined by `-`, unique among the plugin's editor actions. */
  readonly id: string;
  readonly field: PluginEditorField;
  /** The button's words, such as `Suggest title`. */
  readonly label: string;
  /**
   * Whether the button is offered for this draft. Asked when the editor opens
   * and again when the button is pressed. Absent offers it always.
   */
  offers?(draft: PluginEditorDraft): boolean;
  suggest(context: PluginEditorContext): PluginEditorSuggestion | Promise<PluginEditorSuggestion>;
}

/** What a plugin's {@link PluginHost.fetch} sends besides the URL. */
export interface PluginFetchInit {
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** Ends the request, and any redirect it leads to, when it aborts. */
  readonly signal?: AbortSignal | undefined;
}

/** What a plugin knows of the site it runs on. */
export interface PluginSiteInfo {
  /** The site's public URL. */
  readonly baseUrl: string;
  /** The site title, as the site's settings have it now. */
  readonly title: string;
}

/**
 * A plugin's only door into the CMS, handed to {@link Plugin.register}. It
 * reaches no other plugin during `register`: registration order never
 * matters. Everything is declared during `register`; a declaration after it
 * returns throws.
 */
export interface PluginHost<
  Name extends string = string,
  Requires extends PluginRequirements = PluginRequirements,
> {
  /** {@link HOST_API_VERSION} of the core running the plugin. */
  readonly apiVersion: number;
  /** The name of the plugin this host belongs to. */
  readonly name: Name;
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
   * Declare the plugin's settings, which core draws as a form on its screen.
   * At most once per plugin. Public values are kept under the plugin's key in
   * `content/_data/site.json`; secrets in `secrets.json` in its data folder,
   * or in the environment variable named by the package name, `__` and the
   * key, upper-cased with every run of other characters as one `_`.
   */
  settings<const Fields extends readonly PluginSettingField[]>(
    fields: Fields,
  ): PluginSettings<Fields>;
  /**
   * Add a command to the command line. It runs whenever the plugin is
   * installed and available, enabled or not.
   */
  command(command: PluginCommand): void;
  /**
   * Add a button beside a field of the post and page editor, drawn while the
   * plugin is enabled. Pressing it posts the draft to
   * `/admin/plugins/<package name>/editor/<id>`, which only a signed-in user
   * with the page's CSRF token reaches.
   */
  editorAction(action: PluginEditorAction): void;
  /** The site's base URL and title, read when asked. */
  siteInfo(): PluginSiteInfo;
  /**
   * `GET` another site's URL. Redirects are followed, at most five, and every
   * address on the way must be public: a loopback, private or link-local
   * address, or a name that resolves to one, rejects with an error, unless
   * the site lets its federation reach private addresses. Rejects as `fetch`
   * does when the host cannot be reached; any status is answered as it came.
   */
  fetch(url: string, init?: PluginFetchInit): Promise<Response>;
  /**
   * Offer this plugin's service to the plugins that require it, under the
   * plugin's own package name. At most once per plugin, during `register`.
   * Every consumer receives this one instance, so it carries plain data and
   * the host's types across, never an object built by a library.
   */
  provide(service: PluginService<Name>): void;
  /**
   * The service a required plugin provides. Only a name in `requires` is
   * accepted, and only once every plugin has registered: call it when
   * handling a request, a command or a job, never in `register`.
   */
  use<Dependency extends keyof Requires & string>(name: Dependency): PluginService<Dependency>;
}

/**
 * The plugins this one depends on: package name to the semver range it
 * needs, the same pairs as its peer dependencies.
 */
export type PluginRequirements = Readonly<Record<string, string>>;

/** A plugin, as a site config or a bundle's default export hands it over. */
export interface Plugin<
  Name extends string = string,
  Requires extends PluginRequirements = PluginRequirements,
> {
  /**
   * The npm package name, such as `@geekity/plugin-llm`. A plugin installed by
   * hand still declares a package-style name. It is the key of the plugin
   * everywhere: `requires`, the `plugins` key in `site.json` and its data.
   */
  readonly name: Name;
  /** The package version, shown on the Plugins screen. */
  readonly version: string;
  /** What the Plugins screen calls it. */
  readonly label: string;
  /** One or two sentences on what it does. */
  readonly description: string;
  /** The {@link HOST_API_VERSION} it was written against. */
  readonly hostApi: number;
  /** The plugins it needs installed and enabled before it can be enabled. */
  readonly requires?: Requires;
  /**
   * Called once at boot for every installed plugin, enabled or not, to
   * declare what the plugin contributes.
   */
  register(host: PluginHost<Name, Requires>): void;
  /** Called when the plugin starts running: at boot when enabled, and on enable. */
  start?(): void | Promise<void>;
  /** Called when it stops: on disable and when the CMS closes. */
  stop?(): void | Promise<void>;
}

/**
 * Declare a plugin, typed. Returns it unchanged. Its name and `requires` are
 * kept as written, so `host.use` accepts only a required name and
 * `host.provide` only the service {@link PluginServices} names for the plugin.
 */
export function definePlugin<
  const Name extends string,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- a plugin that names no requirement may use nothing.
  const Requires extends PluginRequirements = {},
>(
  plugin: Plugin<Name, Requires>,
  // Without NoInfer, a call inside `plugins: [...]` infers `requires` from the
  // array's wide type, and `use` would accept any name.
): Plugin<NoInfer<Name>, NoInfer<Requires>> {
  return plugin;
}
