export const SETTING_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const CORE_NAMESPACES = [
  'site',
  'maintenance',
  'dev_mode',
  'mail',
  'akismet',
  'tmdb',
  'hcaptcha',
] as const;

function upperSnake(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function coreEnvPrefix(namespace: string): string {
  return `GEEKITY_${upperSnake(namespace)}`;
}

export function pluginEnvPrefix(name: string): string {
  return upperSnake(name);
}

export function settingVariable(envPrefix: string, key: string): string {
  return `${envPrefix}__${upperSnake(key)}`;
}

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
