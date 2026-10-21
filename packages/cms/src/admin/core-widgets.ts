import { FEDIVERSE_WIDGET } from './widget-fediverse.ts';
import { FOLLOWERS_WIDGET } from './widget-followers.ts';
import { INTERACTIONS_WIDGET } from './widget-interactions.ts';
import { TOP_POSTS_WIDGET } from './widget-top-posts.ts';
import type { CoreWidget } from './widgets.ts';

/** The core's own dashboard widgets, drawn in this order before every plugin's. */
export const CORE_WIDGETS: readonly CoreWidget[] = [
  FEDIVERSE_WIDGET,
  FOLLOWERS_WIDGET,
  INTERACTIONS_WIDGET,
  TOP_POSTS_WIDGET,
];
