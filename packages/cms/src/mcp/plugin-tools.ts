import { pluginSite } from '../plugins/site.ts';
import type { GeekityEnv } from '../web/env.ts';
import { callingClient, defineTool } from './tools.ts';
import type { McpTool } from './tools.ts';

export function activePluginTools(vars: Readonly<GeekityEnv['Variables']>): McpTool[] {
  const declared = [...vars.activePlugins].flatMap((name) => vars.plugins.find(name)?.tools ?? []);
  if (declared.length === 0) return [];
  const site = pluginSite({ admin: vars.admin, config: vars.config });
  const timezone = vars.siteAtRequestStart.timezone;
  return declared.map(({ name, tool }) =>
    defineTool({
      name,
      title: tool.title,
      description: tool.description,
      scope: tool.scope,
      annotations: tool.annotations,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      run: (args, { user, token, signal }) =>
        tool.run(args, {
          user: {
            username: user.username,
            ...(user.actorId === undefined ? {} : { actorId: user.actorId }),
          },
          ...callingClient(token),
          signal,
          site,
          timezone,
        }),
    }),
  );
}
