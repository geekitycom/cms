import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { configVariables } from '../config.ts';
import type { ResolvedConfig } from '../config.ts';
import { withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { isRecord } from '../util/guards.ts';
import { AKISMET } from './akismet.ts';
import { DEV_MODE } from './dev-mode.ts';
import { MAIL } from './mail.ts';
import { MAINTENANCE } from './maintenance.ts';
import { reservedNamespaceProblem, settingVariable } from './names.ts';
import type {
  DeclaredNamespace,
  NamespaceDeclaration,
  Resolved,
  SettingChange,
  SettingDeclaration,
  SettingRef,
  SettingsRegistry,
  ValueSource,
  ValuesOf,
} from './types.ts';

const CORE: readonly DeclaredNamespace[] = [MAINTENANCE, DEV_MODE, MAIL, AKISMET];

export interface CreateSettingsRegistryOptions {
  readonly config: ResolvedConfig;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

type Stored = Readonly<Record<string, unknown>>;

type Override<V> =
  { readonly value: V; readonly source: ValueSource } | { readonly problem: string };

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

export function createSettingsRegistry({
  config,
  env = process.env,
}: CreateSettingsRegistryOptions): SettingsRegistry {
  const dirs = { contentDir: config.contentDir, dataDir: config.dataDir };
  const namespaces = new Map(CORE.map(({ declaration }) => [declaration.namespace, declaration]));

  function namespaceOf(name: string): NamespaceDeclaration {
    const found = namespaces.get(name);
    if (found === undefined) throw new Error(`There is no settings namespace ${name}.`);
    return found;
  }

  function fileOf(namespace: NamespaceDeclaration): string {
    const { under, path: relative } = namespace.storage;
    return path.join(under === 'content' ? dirs.contentDir : dirs.dataDir, relative);
  }

  function readStored(namespace: NamespaceDeclaration): Stored {
    let raw: unknown;
    try {
      const text = readFileSync(fileOf(namespace), 'utf8');
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
    const raw = stored[declaration.key];
    if (raw === undefined) return { value: undefined, problem: undefined };
    const parsed = declaration.type.fromJson(raw);
    return parsed.ok
      ? { value: parsed.value, problem: undefined }
      : {
          value: undefined,
          problem: `${namespace.namespace}.${declaration.key} in ${namespace.storage.path} ${parsed.problem}`,
        };
  }

  function writeEveryKeySoNeverReadAsLegacy(
    namespace: NamespaceDeclaration,
    next: Record<string, unknown>,
    stored: Stored,
    changes: ReadonlyMap<string, unknown>,
  ): void {
    for (const declaration of namespace.settings) {
      if (next[declaration.key] !== undefined) continue;
      const kept = changes.has(declaration.key)
        ? undefined
        : storedValue(namespace, declaration, stored).value;
      next[declaration.key] = declaration.type.toJson(kept ?? declaration.default);
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

  function read<T>(namespace: NamespaceDeclaration, use: (stored: Stored) => T): Promise<T> {
    return withFileLock(fileOf(namespace), () => use(readStored(namespace)));
  }

  function resolve<V>(ref: SettingRef<V>): Promise<Resolved<V>> {
    const namespace = namespaceOf(ref.namespace);
    return read(namespace, (stored) => resolveIn(namespace, ref.declaration, stored));
  }

  return {
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
      const file = fileOf(namespace);
      const outcome = await withFileLock(file, () => {
        const stored = readStored(namespace);
        const next: Record<string, unknown> = { ...stored };
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
          if (given === undefined) delete next[key];
          else next[key] = declaration.type.toJson(parsed.value);
          const previous = storedValue(namespace, declaration, stored).value ?? declaration.default;
          if (!isDeepStrictEqual(previous, parsed.value)) {
            changed.push([declaration, previous, parsed.value]);
          }
        }
        if (Object.keys(problems).length === 0) {
          Object.assign(problems, checkProblems(namespace, stored, accepted));
        }
        if (Object.keys(problems).length > 0) return { problems, changed: [] };
        if (namespace.writtenWhole === true) {
          writeEveryKeySoNeverReadAsLegacy(namespace, next, stored, changes);
        }
        const { dataClass } = namespace.storage;
        writeFileAtomicallySync(
          file,
          `${JSON.stringify(next, null, 2)}\n`,
          dataClass.kept && dataClass.secret ? { mode: 0o600 } : {},
        );
        return { problems: undefined, changed };
      });
      if (outcome.problems !== undefined) return { ok: false, problems: outcome.problems };

      const at = config.now();
      for (const [declaration, previous, next] of outcome.changed) {
        const change: SettingChange<unknown> = { previous, next, at, by, dirs };
        try {
          await declaration.onChange?.(change);
        } catch (error) {
          console.error(`The change hook of ${name}.${declaration.key} failed:`, error);
        }
      }
      return { ok: true };
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
      const problem =
        reservedNamespaceProblem(namespace.namespace, namespace.envPrefix) ??
        (namespaces.has(namespace.namespace)
          ? `The settings namespace ${namespace.namespace} is already registered.`
          : undefined);
      if (problem !== undefined) throw new Error(problem);
      namespaces.set(namespace.namespace, namespace);
    },

    unregister(name) {
      if (CORE.some(({ declaration }) => declaration.namespace === name)) return;
      namespaces.delete(name);
    },
  };
}
