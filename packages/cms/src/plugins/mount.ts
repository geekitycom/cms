import type { Hono, MiddlewareHandler } from 'hono';

import type { GeekityEnv } from '../env.ts';
import { readEnabledPlugins } from './enabled.ts';
import type { PluginRegistry } from './registry.ts';

const NONE: ReadonlySet<string> = new Set();

/**
 * Read the enabled set for this request, bring the running plugins into line
 * with it, and put the active set on the context. A site with no plugins
 * reads nothing. A worker draining for a reload has stopped its plugins and
 * leaves them stopped.
 */
export function pluginLifecycle(
  registry: PluginRegistry,
  draining: () => boolean,
): MiddlewareHandler<GeekityEnv> {
  return async (c, next) => {
    c.set('plugins', registry);
    if (registry.plugins.length === 0) {
      c.set('activePlugins', NONE);
    } else {
      const enabled = readEnabledPlugins(c.var.config.contentDir);
      if (!draining()) await registry.reconcile(enabled);
      c.set('activePlugins', registry.active(enabled));
    }
    await next();
  };
}

/**
 * Every available plugin's public routes. A route whose plugin is not active
 * for this request hands on to the next match, so it answers exactly what an
 * absent route would.
 */
export function mountPluginRoutes(app: Hono<GeekityEnv>, registry: PluginRegistry): void {
  for (const { plugin, problem, routes } of registry.plugins) {
    if (problem !== undefined) continue;
    for (const route of routes) {
      app.get(route.path, async (c, next) => {
        if (!c.var.activePlugins.has(plugin.name)) {
          await next();
          return;
        }
        return route.handler({ request: c.req.raw, params: c.req.param() });
      });
    }
  }
}
