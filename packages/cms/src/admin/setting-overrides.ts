import { overridden, sourceText } from '../settings/registry.ts';
import type {
  ChangedBy,
  DeclaredNamespace,
  SetResult,
  SettingsRegistry,
} from '../settings/types.ts';

export async function setElsewhere(
  settings: SettingsRegistry,
  { declaration }: DeclaredNamespace,
  among?: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  const found: Record<string, string> = {};
  for (const each of declaration.settings) {
    if (among !== undefined && !among.includes(each.key)) continue;
    const { source } = await settings.resolve({
      namespace: declaration.namespace,
      key: each.key,
      declaration: each,
    });
    if (overridden(source)) found[each.key] = sourceText(source);
  }
  return found;
}

export async function forgetStored(
  settings: SettingsRegistry,
  namespace: DeclaredNamespace,
  by: ChangedBy,
): Promise<SetResult> {
  const elsewhere = await setElsewhere(settings, namespace);
  const changes = new Map<string, unknown>(
    namespace.declaration.settings
      .filter((each) => elsewhere[each.key] === undefined)
      .map((each) => [each.key, undefined]),
  );
  return await settings.set(namespace.declaration.namespace, changes, by);
}
