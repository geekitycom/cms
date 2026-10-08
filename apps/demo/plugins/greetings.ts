import { definePlugin } from '@geekity/cms/plugin';

/**
 * The second example plugin (decision-33): it contributes nothing of its own
 * and exists so that `hello` has a plugin to require. Enabling Hello on the
 * Plugins screen is refused until this one is enabled.
 */
export default definePlugin({
  name: '@geekity-demo/plugin-greetings',
  version: '0.1.0',
  label: 'Greetings',
  description: 'The example plugin Hello requires. It adds nothing by itself.',
  hostApi: 1,
  register() {},
});
