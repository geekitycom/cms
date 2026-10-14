import { SITE } from '../site/settings.ts';
import type { SiteSettings } from '../site/settings.ts';
import type { SetResult, SettingRef, SettingsRegistry } from '../settings/types.ts';
import { createSerialQueue } from '../util/queue.ts';
import type { SerialQueue } from '../util/queue.ts';
import { siteChanges } from './settings-fields.ts';

const editsBySettings = new WeakMap<SettingsRegistry, SerialQueue>();

function editsOf(settings: SettingsRegistry): SerialQueue {
  let edits = editsBySettings.get(settings);
  if (edits === undefined) {
    edits = createSerialQueue();
    editsBySettings.set(settings, edits);
  }
  return edits;
}

export function editSiteSetting<K extends keyof SiteSettings>(
  settings: SettingsRegistry,
  key: K,
  change: (current: SiteSettings[K]) => SiteSettings[K],
): Promise<SetResult> {
  const ref = SITE[key] as SettingRef<SiteSettings[K]>;
  return editsOf(settings).run(async () => {
    const next = change(await settings.get(ref));
    return await settings.set('site', siteChanges({ [key]: next }), 'admin');
  });
}
