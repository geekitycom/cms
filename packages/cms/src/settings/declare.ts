import { SETTING_NAME } from './names.ts';
import type {
  DeclaredNamespace,
  NamespaceDeclaration,
  SettingDeclaration,
  SettingRef,
  SettingType,
} from './types.ts';

type SettingInput<V> = Omit<SettingDeclaration<V>, 'key'>;

type RefsOf<S> = {
  readonly [K in keyof S]: S[K] extends { type: SettingType<infer V> } ? SettingRef<V> : never;
};

/**
 * A namespace's declaration and one typed ref per setting, so a caller writes
 * `settings.get(MAINTENANCE.on)` and gets a `boolean`.
 */
export function declareNamespace<S extends Record<string, SettingInput<unknown>>>(
  input: Omit<NamespaceDeclaration, 'settings'> & { readonly settings: S },
): DeclaredNamespace & RefsOf<S> {
  const { settings: inputs, ...rest } = input;
  const settings = Object.entries(inputs).map(([key, each]) => {
    if (!SETTING_NAME.test(key) || key === 'declaration') {
      throw new Error(`${input.namespace}.${key} is not lower case words joined by "_".`);
    }
    return { key, ...each };
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
