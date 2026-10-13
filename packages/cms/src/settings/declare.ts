import { SETTING_NAME } from './names.ts';
import type {
  DeclaredNamespace,
  NamespaceDeclaration,
  SettingDeclaration,
  SettingRef,
  ValuesOf,
} from './types.ts';

type SettingInput<V> = Omit<SettingDeclaration<V>, 'key' | 'default'> & {
  readonly default: NoInfer<V>;
};

type RefsOf<S> = { readonly [K in keyof S]: SettingRef<S[K]> };

/** `S` maps each key to its value type, inferred from the declaration's `type` and `default`. */
export function declareNamespace<S extends Record<string, unknown>>(
  input: Omit<NamespaceDeclaration, 'settings'> & {
    readonly settings: { readonly [K in keyof S]: SettingInput<S[K]> };
  },
): DeclaredNamespace & RefsOf<S> {
  const { settings: inputs, ...rest } = input;
  const settings = Object.entries(inputs).map(([key, each]) => {
    if (!SETTING_NAME.test(key) || key === 'declaration') {
      throw new Error(`${input.namespace}.${key} is not lower case words joined by "_".`);
    }
    return { key, ...(each as SettingInput<unknown>) };
  });
  const declaration: NamespaceDeclaration = { ...rest, settings };
  const refs = Object.fromEntries(
    settings.map((each) => [
      each.key,
      { namespace: input.namespace, key: each.key, declaration: each },
    ]),
  );
  return { declaration, ...refs } as DeclaredNamespace & RefsOf<S>;
}

export function defaultValues<N extends DeclaredNamespace>(declared: N): ValuesOf<N> {
  return Object.fromEntries(
    declared.declaration.settings.map((each) => [each.key, each.default]),
  ) as ValuesOf<N>;
}
