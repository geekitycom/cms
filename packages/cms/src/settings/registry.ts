import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { configVariables } from '../config.ts';
import type { ResolvedConfig } from '../config.ts';
import { withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { dataPath, declareDataFile, writtenPrivately } from '../files/data-files.ts';
import type { DataClass, DataFileDeclaration } from '../files/data-files.ts';
import { isRecord } from '../util/guards.ts';
import { AKISMET } from './akismet.ts';
import { DEV_MODE } from './dev-mode.ts';
import { HCAPTCHA } from './hcaptcha.ts';
import { MAIL } from './mail.ts';
import { MAINTENANCE } from './maintenance.ts';
import { TMDB } from './tmdb.ts';
import { CORE_NAMESPACES, reservedNamespaceProblem, settingVariable } from './names.ts';
import type {
  ChangeListener,
  DeclaredNamespace,
  NamespaceDeclaration,
  NamespaceStorage,
  Resolved,
  SettingChange,
  SettingDeclaration,
  SettingRef,
  SettingsRegistry,
  ValueSource,
  ValuesOf,
} from './types.ts';

const CORE: readonly DeclaredNamespace[] = [MAINTENANCE, DEV_MODE, MAIL, AKISMET, TMDB, HCAPTCHA];

export interface CreateSettingsRegistryOptions {
  readonly config: ResolvedConfig;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly coreDeclaredAbove?: readonly DeclaredNamespace[];
}

type Stored = Readonly<Record<string, unknown>>;

type NonEmpty<T> = readonly [T, ...T[]];

interface NamespaceFile {
  readonly file: string;
  readonly relativePath: string;
  readonly writtenPrivately: boolean;
  readonly settings: readonly SettingDeclaration<unknown>[];
}

interface FileRecord extends NamespaceFile {
  readonly stored: Stored;
}

interface FileDraft extends NamespaceFile {
  readonly next: Record<string, unknown>;
  touched: boolean;
}

interface Snapshot {
  readonly rawValues: Stored;
  readonly records: NonEmpty<FileRecord>;
}

function mapNonEmpty<T, U>(items: NonEmpty<T>, map: (item: T) => U): NonEmpty<U> {
  const [first, ...rest] = items;
  return [map(first), ...rest.map(map)];
}

function fileFor<F extends NamespaceFile>(files: NonEmpty<F>, key: string): F {
  return files.find((each) => each.settings.some((setting) => setting.key === key)) ?? files[0];
}

type Override<V> =
  { readonly value: V; readonly source: ValueSource } | { readonly problem: string };

function rawIn(declaration: SettingDeclaration<unknown>, stored: Stored): unknown {
  const { fileKeys } = declaration;
  if (fileKeys === undefined) return stored[declaration.fileKey ?? declaration.key];
  if (fileKeys.every((key) => stored[key] === undefined)) return undefined;
  return Object.fromEntries(fileKeys.map((key) => [key, stored[key]]));
}

function writeRaw(
  next: Record<string, unknown>,
  declaration: SettingDeclaration<unknown>,
  json: unknown,
): void {
  const { fileKeys } = declaration;
  const entries: [string, unknown][] =
    fileKeys === undefined
      ? [[declaration.fileKey ?? declaration.key, json]]
      : fileKeys.map((key) => [key, isRecord(json) ? json[key] : undefined]);
  for (const [key, value] of entries) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
}

export function storedValues<N extends DeclaredNamespace>(
  declared: N,
  stored: Readonly<Record<string, unknown>>,
): ValuesOf<N> {
  return Object.fromEntries(
    declared.declaration.settings.map((declaration) => {
      const raw = rawIn(declaration, stored);
      const parsed = raw === undefined ? undefined : declaration.type.fromJson(raw);
      return [declaration.key, parsed?.ok === true ? parsed.value : declaration.default];
    }),
  ) as ValuesOf<N>;
}

export function fileWith<N extends DeclaredNamespace>(
  declared: N,
  values: ValuesOf<N>,
  existing: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const file: Record<string, unknown> = { ...existing };
  const byKey = values as Readonly<Record<string, unknown>>;
  for (const declaration of declared.declaration.settings) {
    writeRaw(file, declaration, declaration.type.toJson(byKey[declaration.key]));
  }
  return file;
}

export function sourceText(source: ValueSource): string {
  switch (source.tier) {
    case 'env':
      return source.variable;
    case 'config':
      return `${source.field} in the config`;
    case 'file':
      return 'the file';
    case 'default':
      return 'the default';
  }
}

export function overridden(source: ValueSource): boolean {
  return source.tier === 'env' || source.tier === 'config';
}

export function sourceLabel(source: ValueSource): string {
  switch (source.tier) {
    case 'env':
      return `env ${source.variable}`;
    case 'config':
      return `config ${source.field}`;
    case 'file':
    case 'default':
      return source.tier;
  }
}

const FOLDER_FILES: NonEmpty<{
  readonly secret: boolean;
  readonly dataClass: DataClass;
  readonly lost: string;
}> = [
  { secret: false, dataClass: { kind: 'kept' }, lost: "The plugin's public settings." },
  { secret: true, dataClass: { kind: 'credential' }, lost: "The plugin's API keys." },
];

interface DeclaredFile {
  readonly declaration: DataFileDeclaration | undefined;
  readonly relativePath: string;
  readonly settings: readonly SettingDeclaration<unknown>[];
}

function folderFiles(
  namespace: NamespaceDeclaration,
  storage: Extract<NamespaceStorage, { kind: 'folder' }>,
): NonEmpty<DeclaredFile> {
  return mapNonEmpty(FOLDER_FILES, ({ secret, dataClass, lost }) => {
    const declaration = declareDataFile({
      pattern: path.posix.join(storage.path, secret ? storage.secretFile : storage.publicFile),
      dataClass,
      lost,
    });
    return {
      declaration,
      relativePath: declaration.pattern,
      settings: namespace.settings.filter((each) => (each.secret === true) === secret),
    };
  });
}

function declaredFiles(namespace: NamespaceDeclaration): NonEmpty<DeclaredFile> {
  const { storage, settings } = namespace;
  if (storage.kind === 'folder') return folderFiles(namespace, storage);
  return storage.under === 'data'
    ? [{ declaration: storage.file, relativePath: storage.file.pattern, settings }]
    : [{ declaration: undefined, relativePath: storage.path, settings }];
}

export function createSettingsRegistry({
  config,
  env = process.env,
  coreDeclaredAbove = [],
}: CreateSettingsRegistryOptions): SettingsRegistry {
  const dirs = {
    contentDir: config.contentDir,
    dataDir: config.dataDir,
    themesDir: config.themesDir,
  };
  const namespaces = new Map(
    [...CORE, ...coreDeclaredAbove].map(({ declaration }) => [declaration.namespace, declaration]),
  );
  const watchers = new Map<string, Set<ChangeListener<unknown>>>();

  function namespaceOf(name: string): NamespaceDeclaration {
    const found = namespaces.get(name);
    if (found === undefined) throw new Error(`There is no settings namespace ${name}.`);
    return found;
  }

  function filesOf(namespace: NamespaceDeclaration): NonEmpty<NamespaceFile> {
    return mapNonEmpty(declaredFiles(namespace), ({ declaration, relativePath, settings }) => ({
      file:
        declaration === undefined
          ? path.join(dirs.contentDir, relativePath)
          : dataPath(dirs.dataDir, declaration),
      relativePath,
      writtenPrivately: declaration !== undefined && writtenPrivately(declaration),
      settings,
    }));
  }

  function readSnapshot(namespace: NamespaceDeclaration): Snapshot {
    const records = mapNonEmpty(filesOf(namespace), (each) => ({
      ...each,
      stored: readRecord(namespace, each.file),
    }));
    const rawValues: Record<string, unknown> = {};
    for (const record of records) {
      for (const declaration of record.settings) {
        writeRaw(rawValues, declaration, rawIn(declaration, record.stored));
      }
    }
    return { rawValues, records };
  }

  function readRecord(namespace: NamespaceDeclaration, file: string): Stored {
    let raw: unknown;
    try {
      const text = readFileSync(file, 'utf8');
      try {
        raw = JSON.parse(text);
      } catch {
        raw = text;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      raw = undefined;
    }
    const shaped = namespace.legacy === undefined ? raw : namespace.legacy(raw);
    return isRecord(shaped) ? shaped : {};
  }

  function overrideOf<V>(
    namespace: NamespaceDeclaration,
    declaration: SettingDeclaration<V>,
  ): Override<V> | undefined {
    let problem: string | undefined;
    if (declaration.env !== false) {
      const variable = settingVariable(namespace.envPrefix, declaration.key);
      const text = env[variable];
      if (text !== undefined && text !== '') {
        const parsed = declaration.type.fromText(text);
        if (parsed.ok) return { value: parsed.value, source: { tier: 'env', variable } };
        problem = `${variable} ${parsed.problem}`;
      }
    }
    const override = declaration.override;
    if (override !== undefined) {
      const value = override.value(config);
      if (value !== undefined) return { value, source: configSource(override.field) };
    }
    return problem === undefined ? undefined : { problem };
  }

  function configSource(field: string): ValueSource {
    const variable = configVariables(field).find((each) => (env[each] ?? '') !== '');
    return variable === undefined ? { tier: 'config', field } : { tier: 'env', variable };
  }

  function storedValue<V>(
    namespace: NamespaceDeclaration,
    declaration: SettingDeclaration<V>,
    stored: Stored,
  ): { value: V | undefined; problem: string | undefined } {
    const raw = rawIn(declaration, stored);
    if (raw === undefined) return { value: undefined, problem: undefined };
    const parsed = declaration.type.fromJson(raw);
    if (parsed.ok) return { value: parsed.value, problem: undefined };
    const { relativePath } = fileFor(filesOf(namespace), declaration.key);
    return {
      value: undefined,
      problem: `${namespace.namespace}.${declaration.key} in ${relativePath} ${parsed.problem}`,
    };
  }

  function writeEveryKey(
    namespace: NamespaceDeclaration,
    settings: readonly SettingDeclaration<unknown>[],
    next: Record<string, unknown>,
    stored: Stored,
    changes: ReadonlyMap<string, unknown>,
  ): void {
    for (const declaration of settings) {
      if (changes.get(declaration.key) !== undefined) continue;
      const kept = changes.has(declaration.key)
        ? undefined
        : storedValue(namespace, declaration, stored).value;
      writeRaw(next, declaration, declaration.type.toJson(kept ?? declaration.default));
    }
  }

  function checkProblems(
    namespace: NamespaceDeclaration,
    stored: Stored,
    accepted: ReadonlyMap<string, unknown>,
  ): Record<string, string> {
    const after = Object.fromEntries(
      namespace.settings.map((each) => [
        each.key,
        accepted.has(each.key) ? accepted.get(each.key) : resolveIn(namespace, each, stored).value,
      ]),
    );
    const problems: Record<string, string> = {};
    for (const [key, value] of accepted) {
      const declaration = namespace.settings.find((each) => each.key === key);
      const problem = declaration?.check?.(value, after, dirs);
      if (problem !== undefined) problems[key] = problem;
    }
    return problems;
  }

  function resolveIn<V>(
    namespace: NamespaceDeclaration,
    declaration: SettingDeclaration<V>,
    stored: Stored,
  ): Resolved<V> {
    const fromFile = storedValue(namespace, declaration, stored);
    const override = overrideOf(namespace, declaration);
    if (override !== undefined && 'value' in override) {
      return { ...override, stored: fromFile.value, problem: fromFile.problem };
    }
    const problem = override?.problem ?? fromFile.problem;
    return fromFile.value === undefined
      ? { value: declaration.default, source: { tier: 'default' }, stored: undefined, problem }
      : { value: fromFile.value, source: { tier: 'file' }, stored: fromFile.value, problem };
  }

  function locked<T>(namespace: NamespaceDeclaration, task: () => T): Promise<T> {
    return filesOf(namespace).reduceRight<() => Promise<T>>(
      (inner, { file }) =>
        () =>
          withFileLock(file, inner),
      () => Promise.resolve(task()),
    )();
  }

  function read<T>(namespace: NamespaceDeclaration, use: (stored: Stored) => T): Promise<T> {
    return locked(namespace, () => use(readSnapshot(namespace).rawValues));
  }

  function resolve<V>(ref: SettingRef<V>): Promise<Resolved<V>> {
    const namespace = namespaceOf(ref.namespace);
    return read(namespace, (stored) => resolveIn(namespace, ref.declaration, stored));
  }

  async function told(
    name: string,
    declaration: SettingDeclaration<unknown>,
    change: SettingChange<unknown>,
  ): Promise<void> {
    const listeners: ChangeListener<unknown>[] = [
      (each) => declaration.onChange?.(each),
      ...(watchers.get(`${name}.${declaration.key}`) ?? []),
    ];
    for (const listener of listeners) {
      try {
        await listener(change);
      } catch (error) {
        console.error(`The change hook of ${name}.${declaration.key} failed:`, error);
      }
    }
  }

  const registry: SettingsRegistry = {
    resolve,

    async get(ref) {
      return (await resolve(ref)).value;
    },

    values<N extends DeclaredNamespace>(declared: N): Promise<ValuesOf<N>> {
      const namespace = namespaceOf(declared.declaration.namespace);
      return read(
        namespace,
        (stored) =>
          Object.fromEntries(
            namespace.settings.map((each) => [each.key, resolveIn(namespace, each, stored).value]),
          ) as ValuesOf<N>,
      );
    },

    async set(name, changes, by) {
      const namespace = namespaceOf(name);
      const outcome = await locked(namespace, () => {
        const { rawValues: stored, records } = readSnapshot(namespace);
        const drafts = mapNonEmpty(records, ({ stored: record, ...each }): FileDraft => ({
          ...each,
          next: { ...record },
          touched: namespace.writtenWhole === true,
        }));
        const problems: Record<string, string> = {};
        const changed: [SettingDeclaration<unknown>, unknown, unknown][] = [];
        const accepted = new Map<string, unknown>();
        for (const [key, given] of changes) {
          const declaration = namespace.settings.find((each) => each.key === key);
          if (declaration === undefined) {
            problems[key] = `${name} has no setting ${key}.`;
            continue;
          }
          const override = overrideOf(namespace, declaration);
          if (override !== undefined && 'value' in override) {
            problems[key] =
              `${name}.${key} is set by ${sourceText(override.source)} and cannot be changed here.`;
            continue;
          }
          const parsed =
            given === undefined
              ? { ok: true as const, value: declaration.default }
              : declaration.type.fromJson(given);
          if (!parsed.ok) {
            problems[key] = `${name}.${key} ${parsed.problem}.`;
            continue;
          }
          accepted.set(key, parsed.value);
          const draft = fileFor(drafts, key);
          draft.touched = true;
          writeRaw(
            draft.next,
            declaration,
            given === undefined ? undefined : declaration.type.toJson(parsed.value),
          );
          const previous = storedValue(namespace, declaration, stored).value ?? declaration.default;
          if (!isDeepStrictEqual(previous, parsed.value)) {
            changed.push([declaration, previous, parsed.value]);
          }
        }
        if (Object.keys(problems).length === 0) {
          Object.assign(problems, checkProblems(namespace, stored, accepted));
        }
        if (Object.keys(problems).length > 0) return { problems, changed: [] };
        for (const draft of drafts) {
          if (!draft.touched) continue;
          if (namespace.writtenWhole === true) {
            writeEveryKey(namespace, draft.settings, draft.next, stored, changes);
          }
          writeFileAtomicallySync(
            draft.file,
            `${JSON.stringify(draft.next, null, 2)}\n`,
            draft.writtenPrivately ? { mode: 0o600 } : {},
          );
        }
        return { problems: undefined, changed };
      });
      if (outcome.problems !== undefined) return { ok: false, problems: outcome.problems };

      const at = config.now();
      for (const [declaration, previous, next] of outcome.changed) {
        await told(name, declaration, { previous, next, at, by, dirs, settings: registry });
      }
      return { ok: true };
    },

    watch<V>(setting: SettingRef<V>, listener: ChangeListener<V>) {
      const id = `${setting.namespace}.${setting.key}`;
      const listeners = watchers.get(id) ?? new Set<ChangeListener<unknown>>();
      watchers.set(id, listeners);
      const each = listener as ChangeListener<unknown>;
      listeners.add(each);
      return () => {
        listeners.delete(each);
      };
    },

    dataFiles() {
      return [...namespaces.values()].flatMap((namespace) =>
        declaredFiles(namespace).flatMap(({ declaration }) => declaration ?? []),
      );
    },

    list() {
      return [...namespaces.values()].flatMap((namespace) =>
        namespace.settings.map((declaration) => ({
          namespace: namespace.namespace,
          key: declaration.key,
          declaration,
        })),
      );
    },

    register(namespace) {
      const sharing = [...namespaces.values()].find(
        (each) => each.envPrefix === namespace.envPrefix,
      );
      const problem =
        reservedNamespaceProblem(namespace.namespace, namespace.envPrefix) ??
        (namespaces.has(namespace.namespace)
          ? `The settings namespace ${namespace.namespace} is already registered.`
          : undefined) ??
        (sharing === undefined
          ? undefined
          : `Its environment variables would start ${namespace.envPrefix}__, as those of ${sharing.namespace} do.`);
      if (problem !== undefined) throw new Error(problem);
      namespaces.set(namespace.namespace, namespace);
    },

    unregister(name) {
      if ((CORE_NAMESPACES as readonly string[]).includes(name)) return;
      namespaces.delete(name);
    },
  };
  return registry;
}
