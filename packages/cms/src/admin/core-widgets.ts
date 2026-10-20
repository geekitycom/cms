import { FEDIVERSE_WIDGET } from './widget-fediverse.ts';
import type { CoreWidget } from './widgets.ts';

/** The core's own dashboard widgets, drawn in this order before every plugin's. */
export const CORE_WIDGETS: readonly CoreWidget[] = [FEDIVERSE_WIDGET];
