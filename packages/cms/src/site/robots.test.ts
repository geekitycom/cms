import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { robotsRuleLines, robotsRuleProblem } from './robots.ts';

describe('the robots rules a site adds', () => {
  it('accepts rules under a User-agent line', () => {
    assert.equal(robotsRuleProblem(['User-agent: Bingbot', 'Disallow: /drafts/']), undefined);
  });

  it('refuses a rule with no User-agent above it, a stranger line, and opening the admin', () => {
    assert.match(robotsRuleProblem(['Disallow: /x/']) ?? '', /needs a User-agent line/);
    assert.match(robotsRuleProblem(['nonsense']) ?? '', /is not a robots.txt rule/);
    assert.match(robotsRuleProblem(['User-agent: *', 'Allow: /admin/']) ?? '', /\/admin\//);
  });

  it('keeps the good lines and drops the bad and the blank edges', () => {
    assert.deepEqual(
      robotsRuleLines(['', 'User-agent: *', 'Allow: /admin/x', 'Disallow: /a/', '']),
      ['User-agent: *', 'Disallow: /a/'],
    );
  });
});
