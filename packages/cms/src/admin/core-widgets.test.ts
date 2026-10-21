import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CORE_WIDGETS } from './core-widgets.ts';

describe('the core dashboard widgets (TASK-470)', () => {
  it('are all half width, so the activity cards sit two to a row', () => {
    const activity = CORE_WIDGETS.filter((widget) => widget.placement !== 'alerts');
    assert.deepEqual(
      activity.filter((widget) => widget.width !== 'half').map((widget) => widget.id),
      [],
    );
  });
});
