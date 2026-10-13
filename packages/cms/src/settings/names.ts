/** A namespace or key: lower case words joined by `_`, never `__`. */
export const SETTING_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * The namespaces core owns, declared now or in a later wave. No plugin may
 * take one, and none may start `plugin`, because `@geekity/plugin-x` takes
 * the environment prefix `GEEKITY_PLUGIN_X`.
 */
export const CORE_NAMESPACES = ['site', 'maintenance', 'dev_mode', 'mail', 'akismet'] as const;

export function upperSnake(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** `GEEKITY_MAINTENANCE` for the `maintenance` namespace. */
export function coreEnvPrefix(namespace: string): string {
  return `GEEKITY_${upperSnake(namespace)}`;
}

/**
 * What every environment variable of a package starts with, before `__`:
 * `GEEKITY_PLUGIN_LLM` for `@geekity/plugin-llm`. It never contains `__`, so
 * no plugin variable can shadow a core one.
 */
export function pluginEnvPrefix(name: string): string {
  return upperSnake(name);
}

/** `<PREFIX>__<KEY>`, such as `GEEKITY_MAINTENANCE__ON`. */
export function settingVariable(envPrefix: string, key: string): string {
  return `${envPrefix}__${upperSnake(key)}`;
}

/** Why a plugin may not have this namespace or prefix, or `undefined` when it may. */
export function reservedNamespaceProblem(namespace: string, envPrefix: string): string | undefined {
  if ((CORE_NAMESPACES as readonly string[]).includes(namespace)) {
    return `The settings namespace ${namespace} is reserved for core settings.`;
  }
  if (envPrefix === 'GEEKITY') {
    return `Its environment variables would start GEEKITY__, which is reserved for core.`;
  }
  const core = CORE_NAMESPACES.find((each) => coreEnvPrefix(each) === envPrefix);
  if (core !== undefined) {
    return `Its environment variables would start ${envPrefix}__, as core's ${core} settings do.`;
  }
  return undefined;
}
