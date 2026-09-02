import type { ResolvedConfig } from './config.ts';
import type { ContentStore } from './content/store.ts';
import type { Renderer } from './web/render.ts';

/**
 * What every Hono handler in the CMS can read off the context, so a route
 * never has to be handed the store, the config or the theme by hand.
 */
export interface GeekityEnv {
  Variables: {
    /** The derived content index this CMS booted. */
    store: ContentStore;
    /** Config after defaults and environment overrides. */
    config: ResolvedConfig;
    /** The theme, for handlers that answer with HTML. */
    renderer: Renderer;
  };
}
