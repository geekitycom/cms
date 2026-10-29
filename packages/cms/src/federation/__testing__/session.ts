import { browser } from '../../admin/__testing__/harness.ts';
import type { Browser } from '../../admin/__testing__/harness.ts';
import { writeUsers } from '../../admin/__testing__/users.ts';
import type { Cms } from '../../index.ts';
import { listUsers } from '../../site/users.ts';

/**
 * A browser holding a signed-in session for `username`, the session the setup
 * or login form would have left behind, without either form.
 *
 * Both forms run argon2, a few hundred milliseconds of CPU that proves nothing
 * about federation, webmention or IndieAuth and that every test in these files
 * would otherwise spend. The admin tests walk the forms themselves.
 *
 * A site with no accounts gets `username` as its first one, as the setup form
 * would make it; a site that has accounts must already have this one.
 */
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
