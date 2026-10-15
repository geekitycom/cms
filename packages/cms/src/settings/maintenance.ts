import { declareDataFile } from '../files/data-files.ts';
import { declareNamespace } from './declare.ts';
import { boolean, instantOrEmpty } from './kinds.ts';
import { presenceMeansOn } from './presence.ts';

export const MAINTENANCE_FILE = declareDataFile({
  pattern: 'maintenance.json',
  dataClass: { kind: 'rebuildable' },
  lost: 'Maintenance mode, which falls back to off.',
});

export const MAINTENANCE = declareNamespace({
  namespace: 'maintenance',
  storage: { kind: 'file', under: 'data', file: MAINTENANCE_FILE },
  envPrefix: 'GEEKITY_MAINTENANCE',
  legacy: presenceMeansOn,
  writtenWhole: true,
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
