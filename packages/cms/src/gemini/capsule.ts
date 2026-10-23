import { DEFAULT_GEMINI_PORT } from '../config.ts';
import type { ResolvedConfig } from '../config.ts';
import type { SiteSettings } from '../site/settings.ts';
import { geminiHost } from './site-certificate.ts';

export function capsuleUrl(
  config: Pick<ResolvedConfig, 'baseUrl' | 'baseUrlSource' | 'geminiPort'>,
  site: SiteSettings,
  path: string,
): string | undefined {
  if (!site.gemini) return undefined;
  const port = config.geminiPort === DEFAULT_GEMINI_PORT ? '' : `:${String(config.geminiPort)}`;
  return `gemini://${geminiHost(config, site)}${port}${path}`;
}
