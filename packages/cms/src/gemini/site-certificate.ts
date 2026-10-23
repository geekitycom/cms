import type { ResolvedConfig } from '../config.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { SITE, effectiveBaseUrl } from '../site/settings.ts';
import type { SiteSettings } from '../site/settings.ts';
import { ensureGeminiCertificate } from './certificate.ts';
import type { GeminiCertificateResult } from './certificate.ts';

/** The host a generated certificate names: the base URL's in effect. */
export function geminiHost(
  config: Pick<ResolvedConfig, 'baseUrl' | 'baseUrlSource'>,
  site: SiteSettings,
): string {
  return new URL(effectiveBaseUrl(config, site)).hostname;
}

/** The site's certificate, made on first use, or `undefined` while Gemini is off. */
export async function ensureSiteGeminiCertificate(
  config: ResolvedConfig,
  settings: SettingsRegistry,
): Promise<GeminiCertificateResult | undefined> {
  const site = await settings.values(SITE);
  if (!site.gemini) return undefined;
  return await ensureGeminiCertificate(config, geminiHost(config, site), config.now());
}

/** A certificate that cannot be had leaves Gemini unserved and HTTP serving, and says why. */
export async function warnAboutGeminiCertificate(
  config: ResolvedConfig,
  settings: SettingsRegistry,
): Promise<void> {
  const result = await ensureSiteGeminiCertificate(config, settings);
  if (result !== undefined && !result.ok) console.warn(`Gemini is not served: ${result.problem}`);
}
