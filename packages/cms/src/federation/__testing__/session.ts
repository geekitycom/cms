import { browser } from '../../admin/__testing__/harness.ts';
import type { Browser } from '../../admin/__testing__/harness.ts';
import { writeUsers } from '../../admin/__testing__/users.ts';
import type { Cms } from '../../index.ts';
import { listUsers } from '../../site/users.ts';

export function signedInAs(cms: Cms, username: string): Browser {
  const users = listUsers(cms.config.dataDir);
  if (users.length === 0) writeUsers(cms.config.dataDir, [{ username }]);
  const user = users.length === 0 ? { id: 1 } : users.find((one) => one.username === username);
  if (user === undefined) throw new Error(`The site has no account named ${username}.`);

  const session = cms.admin.createSession({
    userId: user.id,
    lifetimeSeconds: cms.config.sessionLifetime,
  });
  const agent = browser(cms);
  agent.setSession(session.id);
  return agent;
}
