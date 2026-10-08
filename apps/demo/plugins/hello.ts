import { definePlugin } from '@geekity/cms/plugin';

/**
 * The example plugin (decision-33): one public route, `/plugin-hello/`, served
 * only while the plugin is enabled on the Plugins screen. It requires
 * `greetings`, so that has to be enabled first.
 */
export default definePlugin({
  name: '@geekity-demo/plugin-hello',
  version: '0.1.0',
  label: 'Hello',
  description: 'Answers /plugin-hello/ with a greeting from a plugin.',
  hostApi: 1,
  requires: { '@geekity-demo/plugin-greetings': '^0.1.0' },
  register(host) {
    host.get(
      '/plugin-hello/',
      () =>
        new Response(`Hello from a plugin, on host API version ${String(host.apiVersion)}.\n`, {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
    );
  },
});
