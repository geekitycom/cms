import type { ResolvedConfig } from '../config.ts';

/**
 * How a value is parsed, checked and printed. One per kind of value. Methods
 * rather than function properties, so a declaration of one value type is
 * assignable to the registry's `SettingDeclaration<unknown>`.
 */
export interface SettingType<V> {
  /** A JSON value from the file, or `undefined` when the key is absent, to a value or a problem. */
  fromJson(raw: unknown): Parsed<V>;
  /** The text of an environment variable or a CLI argument to a value or a problem. */
  fromText(text: string): Parsed<V>;
  /** A value to what the file stores. `undefined` removes the key. */
  toJson(value: V): unknown;
  /** A value as the CLI prints it and as a form field shows it. */
  toText(value: V): string;
}

export type Parsed<V> =
  { readonly ok: true; readonly value: V } | { readonly ok: false; readonly problem: string };

export type DataClass =
  { readonly kept: true; readonly secret: boolean } | { readonly kept: false };

/** The two directories a site is, as a change hook sees them. */
export interface SettingsDirs {
  readonly contentDir: string;
  readonly dataDir: string;
}

/** Who asked for a change: the admin, the CLI, boot, or a plugin's own code. */
export type ChangedBy = 'admin' | 'cli' | 'boot' | 'plugin';

export interface SettingChange<V> {
  readonly previous: V;
  readonly next: V;
  readonly at: Date;
  readonly by: ChangedBy;
  readonly dirs: SettingsDirs;
  readonly settings: SettingsRegistry;
}

export type ChangeListener<V> = (change: SettingChange<V>) => Promise<void> | void;

/** A field of the resolved config that, when it holds a value, wins over the file. */
export interface ConfigOverride<V> {
  /** The config field, which names the source and, through config.ts, its environment variables. */
  readonly field: keyof ResolvedConfig & string;
  value(config: ResolvedConfig): V | undefined;
}

export type FileSpelling =
  | { readonly fileKey?: string; readonly fileKeys?: never }
  | { readonly fileKeys: readonly string[]; readonly fileKey?: never };

export type SettingDeclaration<V> = SettingFields<V> & FileSpelling;

export interface SettingFields<V> {
  readonly key: string;
  readonly type: SettingType<V>;
  readonly default: V;
  /** One sentence the CLI prints beside the key. Not a label for a form. */
  readonly description: string;
  /** Printed as `(set)` or `(not set)`, never as its value. */
  readonly secret?: boolean;
  /** The config tier, read after the generic variable `<PREFIX>__<KEY>` and before the file. */
  readonly override?: ConfigOverride<V>;
  /** False when the setting has no generic environment variable. */
  readonly env?: boolean;
  check?(
    value: V,
    namespaceAfterSet: Readonly<Record<string, unknown>>,
    dirs: SettingsDirs,
  ): string | undefined;
  /** Runs after the file is written, with what changed. Errors are logged, not thrown. */
  onChange?(change: SettingChange<V>): Promise<void> | void;
}

export interface NamespaceDeclaration {
  readonly namespace: string;
  readonly storage: {
    readonly kind: 'file';
    readonly under: 'content' | 'data';
    readonly path: string;
    readonly dataClass: DataClass;
  };
  readonly settings: readonly SettingDeclaration<unknown>[];
  /**
   * A file written before this namespace had its shape. Runs on a file that is
   * there, with its parsed JSON, its text when it is not JSON, or `undefined`
   * when it cannot be read; the result is read as if it were the file, and the
   * next write stores the new shape.
   */
  legacy?(raw: unknown): unknown;
  readonly writtenWhole?: boolean;
  /** `GEEKITY_<NS>` for core. A plugin gives `pluginEnvPrefix(name)`. */
  readonly envPrefix: string;
}

/** A typed handle: the namespace and key, with the value type carried in the type. */
export interface SettingRef<V> {
  readonly namespace: string;
  readonly key: string;
  readonly declaration: SettingDeclaration<V>;
}

/** A namespace's declaration with one ref per setting, as `declareNamespace` returns it. */
export interface DeclaredNamespace {
  readonly declaration: NamespaceDeclaration;
}

export type ValuesOf<N extends DeclaredNamespace> = {
  readonly [K in Exclude<keyof N, 'declaration'>]: N[K] extends SettingRef<infer V> ? V : never;
};

/** Where a value in effect came from. */
export type ValueSource =
  | { readonly tier: 'env'; readonly variable: string }
  | { readonly tier: 'config'; readonly field: string }
  | { readonly tier: 'file' }
  | { readonly tier: 'default' };

export interface Resolved<V> {
  readonly value: V;
  readonly source: ValueSource;
  /** What the file holds, even when something overrides it. */
  readonly stored: V | undefined;
  /** Why a stored or environment value was set aside, or `undefined`. */
  readonly problem: string | undefined;
}

export type SetResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly problems: Readonly<Record<string, string>> };

export interface SettingsRegistry {
  /** One value in effect. Throws on an unknown setting; that is a programming error. */
  get<V>(setting: SettingRef<V>): Promise<V>;
  /** The value, its source and its stored form. The CLI and the admin use this. */
  resolve<V>(setting: SettingRef<V>): Promise<Resolved<V>>;
  /** Every setting of one namespace in effect. */
  values<N extends DeclaredNamespace>(namespace: N): Promise<ValuesOf<N>>;
  /**
   * Write settings of one namespace in one atomic file update. Each value is
   * given in the form the file stores, and `undefined` removes the key so the
   * default applies (or stores the default, in a namespace written whole). Every key is checked first: an unknown key, a value that
   * does not parse or an override in effect refuses the whole
   * call and nothing is written. Change hooks run after the write, one per
   * setting whose value changed.
   */
  set(namespace: string, changes: ReadonlyMap<string, unknown>, by: ChangedBy): Promise<SetResult>;
  watch<V>(setting: SettingRef<V>, listener: ChangeListener<V>): () => void;
  /** Every declared setting, core first, for the CLI's `list`. */
  list(): readonly SettingRef<unknown>[];
  /** Register a plugin's namespace. Refuses a reserved or clashing namespace. */
  register(namespace: NamespaceDeclaration): void;
  unregister(namespace: string): void;
}
