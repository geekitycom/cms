import { isRecord } from '../util/guards.ts';
import { declareNamespace } from './declare.ts';
import { boolean, instantOrEmpty } from './kinds.ts';

/**
 * Maintenance mode (TASK-130). Under `data/` rather than `content/` because it
 * is operational state: `content/` is published and committed, and a flag that
 * travelled with it would take down every checkout of the site.
 */
export const MAINTENANCE = declareNamespace({
  namespace: 'maintenance',
  storage: { kind: 'file', under: 'data', path: 'maintenance.json', dataClass: { kept: false } },
  envPrefix: 'GEEKITY_MAINTENANCE',
  // Before the registry, the file being there meant on, and a file that could
  // not be read still meant on: taking a site back up over a typo is the surprise.
  legacy: (raw) => (isRecord(raw) ? ('on' in raw ? raw : { on: true, ...raw }) : { on: true }),
  settings: {
    on: {
      type: boolean,
      default: false,
      description: 'Answer 503 to the public site, feeds and inboxes.',
      override: {
        field: 'maintenance',
        value: (config) => (config.maintenance ? true : undefined),
      },
    },
    until: {
      type: instantOrEmpty,
      default: '',
      description: 'When the site is expected back, as an instant. Sent as Retry-After.',
    },
  },
});
