import type { Context } from 'hono';

import { findUserById, verifyUserPassword } from '../site/users.ts';
import type { GeekityEnv } from '../web/env.ts';

export function confirmedUser(c: Context<GeekityEnv>, password: string): string | undefined {
  const userId = c.var.session?.userId;
  if (userId == null || password === '') return undefined;
  const user = findUserById(c.var.config.dataDir, userId);
  if (user === undefined) return undefined;
  return verifyUserPassword(c.var.config.dataDir, user.username, password)?.username;
}
