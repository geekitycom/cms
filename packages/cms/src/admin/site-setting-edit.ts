import { SITE } from '../site/settings.ts';
import type { SiteSettings } from '../site/settings.ts';
import type { SetResult, SettingRef, SettingsRegistry } from '../settings/types.ts';
import { createSerialQueue } from '../util/queue.ts';
import { siteChanges } from './settings-fields.ts';

const edits = createSerialQueue();

export function editSiteSetting<K extends keyof SiteSettings>(
  settings: SettingsRegistry,
  key: K,
  change: (current: SiteSettings[K]) => SiteSettings[K],
): Promise<SetResult> {
  const ref = SITE[key] as SettingRef<SiteSettings[K]>;
  return edits.run(async () => {
    const next = change(await settings.get(ref));
    return await settings.set('site', siteChanges({ [key]: next }), 'admin');
  });
}
