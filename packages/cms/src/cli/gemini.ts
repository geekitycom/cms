import { loadResolvedConfig } from '../config-loader.ts';
import { readGeminiCertificate, regenerateGeminiCertificate } from '../gemini/certificate.ts';
import { geminiHost } from '../gemini/site-certificate.ts';
import { SITE, createSettings } from '../site/namespace.ts';
import type { ParsedArgs } from './args.ts';

export async function geminiCommand({ args, configPath }: ParsedArgs): Promise<number> {
  const action = args[0];
  if (action !== 'cert' && action !== 'new-cert') {
    throw new Error('geekity gemini needs cert or new-cert.');
  }
  const config = await loadResolvedConfig(configPath);
  const host = geminiHost(config, await createSettings({ config }).values(SITE));
  const result =
    action === 'cert'
      ? await readGeminiCertificate(config, host)
      : await regenerateGeminiCertificate(config, host, config.now());
  if (!result.ok) throw new Error(result.problem);
  const { certificate } = result;
  if (action === 'new-cert') {
    process.stdout.write(
      'A new Gemini certificate is written. Every Gemini client that visited before warns that the capsule changed identity. Restart the site to serve it.\n',
    );
  }
  process.stdout.write(
    [
      `Certificate: ${certificate.certFile}${certificate.source === 'operator' ? " (the operator's own)" : ''}`,
      `Subject: ${certificate.subject}`,
      `Expires: ${certificate.validTo.toISOString()}`,
      `SHA-256 fingerprint: ${certificate.fingerprint256}`,
      ...(certificate.coversHost
        ? []
        : [
            `It does not name ${host}, the base URL host. Run geekity gemini new-cert to replace it; every client that pinned it will warn.`,
          ]),
    ].join('\n') + '\n',
  );
  return 0;
}
