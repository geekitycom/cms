import { randomInt } from 'node:crypto';

import type { Hono } from 'hono';

import type { GeekityEnv } from '../env.ts';
import { passwordProblem, usernameProblem } from './credentials.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import { DuplicateUsernameError } from './store.ts';
import type { User } from './store.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** Where the users screen lives. The add form posts here too. */
export const USERS_PATH = `${ADMIN_PREFIX}/users`;

/** Where the signed-in admin's change-password form posts. */
export const CHANGE_PASSWORD_PATH = `${USERS_PATH}/password`;

/** Where a row's delete button posts. */
export const DELETE_USER_PATH = `${USERS_PATH}/delete`;

/** The fields the three forms on the screen submit. */
export const USER_FIELDS = {
  username: 'username',
  password: 'password',
  generate: 'generate',
  currentPassword: 'current_password',
  newPassword: 'new_password',
  newPasswordConfirmation: 'new_password_confirmation',
  userId: 'user_id',
} as const;

/** What {@link mountUsers} needs from the admin around it. */
export interface MountUsersOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/**
 * Register the users screen: the list, the add form, and the change-password
 * form for whoever is signed in.
 *
 * There is one role, so there is nothing to edit about somebody else: an admin
 * can add a user, delete one, and change their own password. Changing
 * somebody else's is deliberately not offered — resetting a colleague's
 * password from under them is what `geekity user add` and a fresh account are
 * for, and it keeps the current-password check honest.
 */
export function mountUsers(app: Hono<GeekityEnv>, options: MountUsersOptions): void {
  const { render } = options;

  app.get(USERS_PATH, (c) => render(c, ADMIN_TEMPLATES.users, screen(c)));

  app.post(USERS_PATH, async (c) => {
    const body = await c.req.parseBody();
    const username = field(body[USER_FIELDS.username]).trim();
    const supplied = field(body[USER_FIELDS.password]);
    const generate = field(body[USER_FIELDS.generate]) !== '';

    const password = generate ? generatePassword() : supplied;
    const problems = addUserProblems(username, password, generate);

    if (Object.keys(problems).length === 0) {
      try {
        c.var.admin.createUser({ username, password });
      } catch (error) {
        if (!(error instanceof DuplicateUsernameError)) throw error;
        problems.username = error.message;
      }
    }

    if (Object.keys(problems).length > 0) {
      c.status(400);
      return render(
        c,
        ADMIN_TEMPLATES.users,
        screen(c, { addForm: { username, generate }, addProblems: problems }),
      );
    }

    // A generated password is shown once, here, and never stored in the clear.
    // The flash lives on the session row, so it is not in the URL, in a cookie
    // or in anybody's history.
    flash(
      c,
      'notice',
      generate
        ? `Added ${username}. Their password is ${password} — copy it now, it is not shown again.`
        : `Added ${username}.`,
    );
    return c.redirect(USERS_PATH, 303);
  });

  app.post(CHANGE_PASSWORD_PATH, async (c) => {
    // The guard has already established that there is a live session with a
    // user behind it, so both of these are present on every path that gets here.
    const session = c.var.session;
    const user =
      session?.userId === null || session === undefined
        ? undefined
        : c.var.admin.getUserById(session.userId);
    if (session === undefined || user === undefined) return c.redirect(USERS_PATH, 303);

    const body = await c.req.parseBody();
    const current = field(body[USER_FIELDS.currentPassword]);
    const next = field(body[USER_FIELDS.newPassword]);
    const confirmation = field(body[USER_FIELDS.newPasswordConfirmation]);

    const problems = changePasswordProblems({
      correct: c.var.admin.verifyPassword(user.username, current) !== undefined,
      next,
      confirmation,
    });

    if (Object.keys(problems).length > 0) {
      c.status(400);
      // Nothing that was typed is echoed back: every field on this form is a
      // password, and a password does not belong in rendered HTML.
      return render(c, ADMIN_TEMPLATES.users, screen(c, { passwordProblems: problems }));
    }

    c.var.admin.setPassword(user.id, next);
    // Every browser that was signed in as this user is signed out, because the
    // usual reason to change a password is that somebody else may have it. The
    // one doing the changing is spared, so the admin is not thrown out of the
    // form they just submitted.
    const ended = c.var.admin.deleteSessionsForUser(user.id, { except: session.id });

    flash(
      c,
      'notice',
      ended === 0
        ? 'Your password was changed.'
        : `Your password was changed, and ${signedOut(ended)} signed out.`,
    );
    return c.redirect(USERS_PATH, 303);
  });

  app.post(DELETE_USER_PATH, async (c) => {
    const admin = c.var.admin;
    const body = await c.req.parseBody();
    const id = Number(field(body[USER_FIELDS.userId]));
    const target = Number.isInteger(id) ? admin.getUserById(id) : undefined;

    const refusal = deleteUserRefusal({
      target,
      signedInAs: c.var.session?.userId ?? null,
      total: admin.countUsers(),
    });

    if (refusal !== undefined) {
      flash(c, 'error', refusal);
      return c.redirect(USERS_PATH, 303);
    }

    // Their sessions go with them: the foreign key cascades, and the
    // connection runs with `PRAGMA foreign_keys = ON`.
    admin.deleteUser((target as User).id);
    flash(c, 'notice', `Deleted ${(target as User).username}.`);
    return c.redirect(USERS_PATH, 303);
  });
}

/**
 * Delete a user.
 *
 * Two refusals, in this order. The last remaining user cannot go, because a
 * site with no users falls back into first-run setup and anybody who reaches
 * it becomes its admin. And nobody may delete their own account: it would end
 * the session doing the deleting, and there is no undo. Both are a flash and a
 * redirect rather than a 400, because nothing was typed to send back.
 */
export function deleteUserRefusal(input: {
  /** The user the form named, or `undefined` when there is no such row. */
  target: User | undefined;
  /** Who is asking. */
  signedInAs: number | null;
  /** How many users the site has. */
  total: number;
}): string | undefined {
  if (input.target === undefined) return 'That user is already gone.';
  if (input.total <= 1) {
    return `${input.target.username} is the only user. Add another before deleting this one.`;
  }
  if (input.target.id === input.signedInAs) {
    return 'You cannot delete your own account. Another admin can do it for you.';
  }
  return undefined;
}

/** One message per field of the change-password form that is wrong. */
export type ChangePasswordProblems = { currentPassword?: string; newPassword?: string };

/**
 * What is wrong with a proposed password change, one message per field.
 *
 * The current password is taken as already checked, rather than checked here,
 * so this stays a pure function over what the store said.
 */
export function changePasswordProblems(input: {
  /** Whether the current password the form carried is this user's. */
  correct: boolean;
  next: string;
  confirmation: string;
}): ChangePasswordProblems {
  const problems: ChangePasswordProblems = {};

  if (!input.correct) problems.currentPassword = 'That is not your current password.';

  const secret = passwordProblem(input.next);
  if (secret !== undefined) problems.newPassword = secret;
  else if (input.next !== input.confirmation) {
    problems.newPassword = 'The two new passwords do not match.';
  }

  return problems;
}

/** "1 other session was" or "3 other sessions were", for the flash. */
function signedOut(count: number): string {
  return count === 1 ? '1 other session was' : `${String(count)} other sessions were`;
}

/** One message per field of the add form that is wrong. */
export type AddUserProblems = { username?: string; password?: string };

/**
 * What is wrong with a proposed user, one message per field.
 *
 * The rules are the shared ones, so an account made here is one
 * `/admin/setup` and `geekity user add` would both have accepted. A generated
 * password is not checked against them — it is made to satisfy them — and the
 * password field is not read at all when the box is ticked, so a stale value
 * left in it cannot be what is refused.
 */
export function addUserProblems(
  username: string,
  password: string,
  generate = false,
): AddUserProblems {
  const problems: AddUserProblems = {};

  const name = usernameProblem(username);
  if (name !== undefined) problems.username = name;

  if (!generate) {
    const secret = passwordProblem(password);
    if (secret !== undefined) problems.password = secret;
  }

  return problems;
}

/**
 * The alphabet a generated password is drawn from: no `0`/`O` and no `1`/`l`,
 * because a generated password is read off a screen and typed somewhere else.
 */
export const GENERATED_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** How many characters a generated password has. 20 is about 116 bits here. */
export const GENERATED_PASSWORD_LENGTH = 20;

/** A password nobody chose, from `randomInt` rather than `Math.random`. */
export function generatePassword(): string {
  let password = '';
  for (let index = 0; index < GENERATED_PASSWORD_LENGTH; index += 1) {
    password += GENERATED_PASSWORD_ALPHABET[randomInt(GENERATED_PASSWORD_ALPHABET.length)];
  }
  return password;
}

/** Everything the users template renders. */
function screen(
  c: Parameters<AdminRender>[0],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const signedInAs = c.var.session?.userId ?? null;
  const users = c.var.admin.listUsers();

  return {
    section: 'users',
    usersUrl: USERS_PATH,
    changePasswordUrl: CHANGE_PASSWORD_PATH,
    deleteUserUrl: DELETE_USER_PATH,
    fields: USER_FIELDS,
    users: users.map((user) => row(user, { signedInAs, total: users.length })),
    addForm: { username: '', generate: false },
    addProblems: {},
    passwordProblems: {},
    ...extra,
  };
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function field(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** One user as the table renders it. */
function row(
  user: User,
  context: { signedInAs: number | null; total: number },
): Record<string, unknown> {
  const you = user.id === context.signedInAs;
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    you,
    // The button is rendered for everybody the signed-in admin may actually
    // delete, so the screen never offers an action it is about to refuse.
    deletable: !you && context.total > 1,
  };
}
