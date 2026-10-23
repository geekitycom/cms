import type { ResolvedConfig } from '../config.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { SITE, effectiveBaseUrl } from '../site/settings.ts';
import type { SiteSettings } from '../site/settings.ts';
import { ensureGeminiCertificate } from './certificate.ts';
import type { GeminiCertificateResult } from './certificate.ts';

export function geminiHost(
  config: Pick<ResolvedConfig, 'baseUrl' | 'baseUrlSource'>,
  site: SiteSettings,
): string {
  return new URL(effectiveBaseUrl(config, site)).hostname;
}

export async function ensureSiteGeminiCertificate(
  config: ResolvedConfig,
  settings: SettingsRegistry,
): Promise<GeminiCertificateResult | undefined> {
  const site = await settings.values(SITE);
  if (!site.gemini) return undefined;
  return await ensureGeminiCertificate(config, geminiHost(config, site), config.now());
}

export async function warnAboutGeminiCertificate(
  config: ResolvedConfig,
  settings: SettingsRegistry,
): Promise<void> {
  const result = await ensureSiteGeminiCertificate(config, settings);
  if (result !== undefined && !result.ok) console.warn(`Gemini is not served: ${result.problem}`);
}
