import { randomInt } from 'node:crypto';

import type { Context, Hono } from 'hono';

import type { GeekityEnv } from '../web/env.ts';
import {
  countUsers,
  createUser,
  removeUserRecord,
  DuplicateUsernameError,
  findUserById,
  listUsers,
  setUserAdminTheme,
  setUserEmail,
  setUserNotification,
  setUserNotificationMode,
  setUserPassword,
  setUserProfile,
  verifyUserPassword,
} from '../site/users.ts';
import type { ProfileLink, User } from '../site/users.ts';
import type { FlashKind } from '../store/admin-store.ts';
import { authorHref } from '../content/authors.ts';
import { isLinkUrl, LINK_REL_RULE, LINK_URL_RULE, splitLinkRel } from '../site/navigation.ts';
import {
  DEFAULT_DELIVERY_MODE,
  deliveryMode,
  notificationEvent,
  notificationSwitches,
} from '../site/notification-preferences.ts';
import { revokeTokensForUser } from '../indieauth/tokens.ts';
import { autosaveCopies } from '../autosave/index.ts';
import { discardWritingLedger } from '../writing/ledger.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { ADMIN_THEMES, adminTheme } from '../site/admin-theme.ts';
import { emailProblem, passwordProblem, usernameProblem } from './credentials.ts';
import type { AdminRender } from './documents.ts';
import { flashAndRedirect } from './flash.ts';
import { editUserPath, USERS_PATH } from '../site/admin-paths.ts';
import { toldFollowers } from './settings-page.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

export const ADD_USER_PATH = `${USERS_PATH}/new`;

function pathId(segment: string): number | undefined {
  if (!/^\d+$/.test(segment)) return undefined;
  return Number(segment);
}

export const CONNECTED_APPS_PATH = `${USERS_PATH}/apps`;

export const CONNECTED_APPS_CHILD = 'apps';

export const APP_ACTIVITY_PATH = `${USERS_PATH}/activity`;

export const APP_ACTIVITY_CHILD = 'activity';

export const CHANGE_PASSWORD_PATH = `${USERS_PATH}/password`;

export const DELETE_USER_PATH = `${USERS_PATH}/delete`;

export const USER_EMAIL_PATH = `${USERS_PATH}/email`;

export const USER_PROFILE_PATH = `${USERS_PATH}/profile`;

export const USER_NOTIFICATIONS_PATH = `${USERS_PATH}/notifications`;

export const USER_NOTIFICATION_MODE_PATH = `${USER_NOTIFICATIONS_PATH}/mode`;

export const USER_THEME_PATH = `${USERS_PATH}/theme`;

export const USER_FIELDS = {
  username: 'username',
  password: 'password',
  email: 'email',
  generate: 'generate',
  currentPassword: 'current_password',
  newPassword: 'new_password',
  newPasswordConfirmation: 'new_password_confirmation',
  userId: 'user_id',
  event: 'event',
  // A browser sends no field for an unticked box, so each event's switch is a
  // form of its own.
  on: 'on',
  mode: 'mode',
  displayName: 'display_name',
  bio: 'bio',
  avatar: 'avatar',
  jobTitle: 'job_title',
  location: 'location',
  links: 'links',
  adminTheme: 'admin_theme',
} as const;

export interface MountUsersOptions {
  render: AdminRender;
}

export function mountUsers(app: Hono<GeekityEnv>, options: MountUsersOptions): void {
  const { render } = options;

  app.get(USERS_PATH, (c) => showUsers(c, render));
  app.get(ADD_USER_PATH, (c) => showAddUser(c, render));
  app.post(ADD_USER_PATH, (c) => addUser(c, render));
  app.post(CHANGE_PASSWORD_PATH, (c) => changePassword(c, render));
  app.post(USER_EMAIL_PATH, saveEmail);
  app.post(USER_PROFILE_PATH, (c) => saveProfile(c, render));
  app.post(USER_NOTIFICATIONS_PATH, saveNotification);
  app.post(USER_NOTIFICATION_MODE_PATH, saveNotificationMode);
  app.post(USER_THEME_PATH, saveTheme);
  app.post(DELETE_USER_PATH, removeUser);
  app.get(`${USERS_PATH}/:id`, (c) => showUser(c, render));
}

function showUsers(c: Context<GeekityEnv>, render: AdminRender): Response {
  return render(c, ADMIN_TEMPLATES.usersList, screen(c));
}

function showAddUser(c: Context<GeekityEnv>, render: AdminRender): Response {
  return render(c, ADMIN_TEMPLATES.usersNew, addScreen(c));
}

async function addUser(c: Context<GeekityEnv>, render: AdminRender): Promise<Response> {
  const body = await c.req.parseBody();
  const username = stringOrEmpty(body[USER_FIELDS.username]).trim();
  const supplied = stringOrEmpty(body[USER_FIELDS.password]);
  const email = stringOrEmpty(body[USER_FIELDS.email]).trim();
  const generate = stringOrEmpty(body[USER_FIELDS.generate]) !== '';

  const password = generate ? generatePassword() : supplied;
  const problems = addUserProblems(username, password, generate, email);

  if (Object.keys(problems).length === 0) {
    try {
      await createUser({
        dataDir: c.var.config.dataDir,
        username,
        password,
        email,
        now: c.var.config.now(),
      });
    } catch (error) {
      if (!(error instanceof DuplicateUsernameError)) throw error;
      problems.username = error.message;
    }
  }

  if (Object.keys(problems).length > 0) {
    c.status(400);
    return render(
      c,
      ADMIN_TEMPLATES.usersNew,
      addScreen(c, { addForm: { username, email, generate }, addProblems: problems }),
    );
  }

  return flashAndRedirect(
    c,
    'notice',
    generate
      ? `Added ${username}. Their password is ${password} — copy it now, it is not shown again.`
      : `Added ${username}.`,
    USERS_PATH,
  );
}

async function changePassword(c: Context<GeekityEnv>, render: AdminRender): Promise<Response> {
  const session = c.var.session;
  const user = signedInUser(c);
  if (session === undefined || user === undefined) return c.redirect(USERS_PATH, 303);

  const body = await c.req.parseBody();
  const current = stringOrEmpty(body[USER_FIELDS.currentPassword]);
  const next = stringOrEmpty(body[USER_FIELDS.newPassword]);
  const confirmation = stringOrEmpty(body[USER_FIELDS.newPasswordConfirmation]);

  const problems = changePasswordProblems({
    correct: verifyUserPassword(c.var.config.dataDir, user.username, current) !== undefined,
    next,
    confirmation,
  });

  if (Object.keys(problems).length > 0) {
    c.status(400);
    return render(
      c,
      ADMIN_TEMPLATES.usersEdit,
      userScreen(c, user, { passwordProblems: problems }),
    );
  }

  await setUserPassword({ dataDir: c.var.config.dataDir, userId: user.id, password: next });
  const ended = c.var.admin.deleteSessionsForUser(user.id, { except: session.id });

  return backToUser(
    c,
    'notice',
    ended === 0
      ? 'Your password was changed.'
      : `Your password was changed, and ${signedOut(ended)} signed out.`,
    user,
  );
}

async function saveEmail(c: Context<GeekityEnv>): Promise<Response> {
  const named = await namedUser(c);
  if (named instanceof Response) return named;
  const { dataDir, body, target } = named;
  const email = stringOrEmpty(body[USER_FIELDS.email]).trim();

  const problem = emailProblem(email);
  if (problem !== undefined) return backToUser(c, 'error', problem, target);

  await setUserEmail({ dataDir, userId: target.id, email });
  return backToUser(
    c,
    'notice',
    email === ''
      ? `${target.username} has no email address any more.`
      : `${target.username} will be emailed at ${email}.`,
    target,
  );
}

async function saveProfile(c: Context<GeekityEnv>, render: AdminRender): Promise<Response> {
  const named = await namedUser(c);
  if (named instanceof Response) return named;
  const { dataDir, body, target } = named;
  const typed = typedProfile(body);

  const problem = profileLinkLineProblem(typed.links);
  if (problem !== undefined) {
    c.status(400);
    return render(
      c,
      ADMIN_TEMPLATES.usersEdit,
      userScreen(c, target, { profileProblems: { links: problem } }, typed),
    );
  }

  const changed = await setUserProfile({
    dataDir,
    userId: target.id,
    profile: { ...typed, links: parseProfileLinks(typed.links) },
  });

  // A follower's copy of somebody's name, bio and picture is only as fresh as
  // the last `Update` they were sent.
  const saved = changed ? findUserById(dataDir, target.id) : undefined;
  const told = saved === undefined ? undefined : await c.var.delivery.updateActor(saved);

  return backToUser(
    c,
    'notice',
    `Saved ${target.username}’s profile.${toldFollowers(told)}`,
    target,
  );
}

function typedProfile(body: Readonly<Record<string, unknown>>) {
  return {
    displayName: stringOrEmpty(body[USER_FIELDS.displayName]),
    bio: stringOrEmpty(body[USER_FIELDS.bio]),
    avatar: stringOrEmpty(body[USER_FIELDS.avatar]),
    jobTitle: stringOrEmpty(body[USER_FIELDS.jobTitle]),
    location: stringOrEmpty(body[USER_FIELDS.location]),
    links: stringOrEmpty(body[USER_FIELDS.links]),
  };
}

async function saveNotification(c: Context<GeekityEnv>): Promise<Response> {
  const named = await namedUser(c);
  if (named instanceof Response) return named;
  const { dataDir, body, target } = named;

  const name = stringOrEmpty(body[USER_FIELDS.event]);
  const event = notificationEvent(name);
  if (event === undefined) {
    return backToUser(
      c,
      'error',
      'That is not something this site can tell anybody about.',
      target,
    );
  }

  // An unticked checkbox submits no field at all, so its absence is the
  // answer rather than a missing one.
  const on = stringOrEmpty(body[USER_FIELDS.on]) !== '';
  await setUserNotification({ dataDir, userId: target.id, event: name, on });

  return backToUser(
    c,
    'notice',
    on
      ? `${target.username} will be emailed about ${event.label.toLowerCase()}.`
      : `${target.username} will not be emailed about ${event.label.toLowerCase()}.`,
    target,
  );
}

async function saveNotificationMode(c: Context<GeekityEnv>): Promise<Response> {
  const named = await namedUser(c);
  if (named instanceof Response) return named;
  const { dataDir, body, target } = named;

  const name = stringOrEmpty(body[USER_FIELDS.event]);
  const event = notificationEvent(name);
  if (event === undefined || !event.batched) {
    return backToUser(c, 'error', 'That is not a notice this site can batch up.', target);
  }

  const wanted = deliveryMode(stringOrEmpty(body[USER_FIELDS.mode]));
  if (wanted === undefined)
    return backToUser(c, 'error', 'That is not one of the choices.', target);

  await setUserNotificationMode({ dataDir, userId: target.id, event: name, mode: wanted });

  return backToUser(
    c,
    'notice',
    wanted === DEFAULT_DELIVERY_MODE
      ? `${target.username} will hear about ${event.label.toLowerCase()} as they arrive.`
      : `${target.username} will get one ${wanted === 'daily' ? 'daily' : 'hourly'} digest of ` +
          `${event.label.toLowerCase()}.`,
    target,
  );
}

async function saveTheme(c: Context<GeekityEnv>): Promise<Response> {
  const user = signedInUser(c);
  if (user === undefined) return c.redirect(USERS_PATH, 303);

  const body = await c.req.parseBody();
  const wanted = stringOrEmpty(body[USER_FIELDS.adminTheme]);
  const theme = adminTheme(wanted);
  if (wanted !== '' && theme === undefined) {
    return backToUser(c, 'error', 'That is not one of the themes.', user);
  }

  await setUserAdminTheme({ dataDir: c.var.config.dataDir, userId: user.id, theme });
  return backToUser(
    c,
    'notice',
    theme === undefined
      ? "The admin follows your system's light or dark setting."
      : `The admin is drawn in ${ADMIN_THEMES[theme].label} for you.`,
    user,
  );
}

async function removeUser(c: Context<GeekityEnv>): Promise<Response> {
  const dataDir = c.var.config.dataDir;
  const target = userInForm(dataDir, await c.req.parseBody());

  const refusal = deleteUserRefusal({
    target,
    signedInAs: c.var.session?.userId ?? null,
    total: countUsers(dataDir),
  });

  if (refusal !== undefined || target === undefined) {
    return flashAndRedirect(c, 'error', refusal ?? GONE_USER, USERS_PATH);
  }

  await deleteUser({ dataDir, userId: target.id, now: c.var.config.now() });
  c.var.admin.deleteSessionsForUser(target.id);
  return flashAndRedirect(c, 'notice', `Deleted ${target.username}.`, USERS_PATH);
}

function showUser(c: Context<GeekityEnv>, render: AdminRender) {
  const id = pathId(c.req.param('id') ?? '');
  const user = id === undefined ? undefined : findUserById(c.var.config.dataDir, id);
  if (user === undefined) return c.notFound();
  return render(c, ADMIN_TEMPLATES.usersEdit, userScreen(c, user));
}

function backToUser(
  c: Context<GeekityEnv>,
  kind: FlashKind,
  message: string,
  user: User,
): Response {
  return flashAndRedirect(c, kind, message, editUserPath(user.id));
}

function userInForm(dataDir: string, body: Readonly<Record<string, unknown>>): User | undefined {
  const id = Number(stringOrEmpty(body[USER_FIELDS.userId]));
  return Number.isInteger(id) ? findUserById(dataDir, id) : undefined;
}

function signedInUser(c: Context<GeekityEnv>): User | undefined {
  const userId = c.var.session?.userId;
  return userId == null ? undefined : findUserById(c.var.config.dataDir, userId);
}

async function namedUser(
  c: Context<GeekityEnv>,
): Promise<{ dataDir: string; body: Readonly<Record<string, unknown>>; target: User } | Response> {
  const dataDir = c.var.config.dataDir;
  const body = await c.req.parseBody();
  const target = userInForm(dataDir, body);
  if (target === undefined) return flashAndRedirect(c, 'error', GONE_USER, USERS_PATH);
  return { dataDir, body, target };
}

const GONE_USER = 'That user is already gone.';

export async function deleteUser(input: {
  dataDir: string;
  userId: number;
  now: Date;
}): Promise<boolean> {
  const deleted = await removeUserRecord(input);
  await revokeTokensForUser(input.dataDir, input.userId, input.now);
  autosaveCopies(input.dataDir).discardUser(input.userId);
  discardWritingLedger(input.dataDir, input.userId);
  return deleted;
}

export function deleteUserRefusal(input: {
  target: User | undefined;
  signedInAs: number | null;
  total: number;
}): string | undefined {
  if (input.target === undefined) return GONE_USER;
  if (input.total <= 1) {
    return `${input.target.username} is the only user. Add another before deleting this one.`;
  }
  if (input.target.id === input.signedInAs) {
    return 'You cannot delete your own account. Another admin can do it for you.';
  }
  return undefined;
}

export type ChangePasswordProblems = { currentPassword?: string; newPassword?: string };

export function changePasswordProblems(input: {
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

function signedOut(count: number): string {
  return count === 1 ? '1 other session was' : `${String(count)} other sessions were`;
}

export type AddUserProblems = { username?: string; password?: string; email?: string };

export function addUserProblems(
  username: string,
  password: string,
  generate = false,
  email = '',
): AddUserProblems {
  const problems: AddUserProblems = {};

  const name = usernameProblem(username);
  if (name !== undefined) problems.username = name;

  if (!generate) {
    const secret = passwordProblem(password);
    if (secret !== undefined) problems.password = secret;
  }

  const address = emailProblem(email);
  if (address !== undefined) problems.email = address;

  return problems;
}

export const GENERATED_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export const GENERATED_PASSWORD_LENGTH = 20;

export function generatePassword(): string {
  let password = '';
  for (let index = 0; index < GENERATED_PASSWORD_LENGTH; index += 1) {
    password += GENERATED_PASSWORD_ALPHABET[randomInt(GENERATED_PASSWORD_ALPHABET.length)];
  }
  return password;
}

function addScreen(
  c: Parameters<AdminRender>[0],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return screen(c, { child: 'new', ...extra });
}

function userScreen(
  c: Parameters<AdminRender>[0],
  user: User,
  extra: Record<string, unknown> = {},
  typedProfile?: Record<string, string>,
): Record<string, unknown> {
  const signedInAs = c.var.session?.userId ?? null;
  const total = countUsers(c.var.config.dataDir);

  return {
    section: 'users',
    child: 'all',
    usersUrl: USERS_PATH,
    userProfileUrl: USER_PROFILE_PATH,
    changePasswordUrl: CHANGE_PASSWORD_PATH,
    deleteUserUrl: DELETE_USER_PATH,
    userEmailUrl: USER_EMAIL_PATH,
    userNotificationsUrl: USER_NOTIFICATIONS_PATH,
    userNotificationModeUrl: USER_NOTIFICATION_MODE_PATH,
    connectedAppsUrl: CONNECTED_APPS_PATH,
    userThemeUrl: USER_THEME_PATH,
    themeChoices: themeChoices(user),
    fields: USER_FIELDS,
    account: {
      ...row(user, { signedInAs, total }),
      ...(typedProfile === undefined ? {} : { profile: typedProfile }),
    },
    deleteRefusal: deleteUserRefusal({ target: user, signedInAs, total }),
    passwordProblems: {},
    profileProblems: {},
    mailConfigured: c.var.mailConfigured,
    ...extra,
  };
}

function screen(
  c: Parameters<AdminRender>[0],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const signedInAs = c.var.session?.userId ?? null;
  const users = listUsers(c.var.config.dataDir);

  return {
    section: 'users',
    child: 'all',
    usersUrl: USERS_PATH,
    addUserUrl: ADD_USER_PATH,
    deleteUserUrl: DELETE_USER_PATH,
    fields: USER_FIELDS,
    users: users.map((user) => row(user, { signedInAs, total: users.length })),
    addForm: { username: '', email: '', generate: false },
    addProblems: {},
    ...extra,
  };
}

function themeChoices(user: User): { value: string; label: string; chosen: boolean }[] {
  return [
    { value: '', label: 'Follow the system', chosen: user.adminTheme === undefined },
    ...Object.entries(ADMIN_THEMES).map(([name, { label }]) => ({
      value: name,
      label,
      chosen: user.adminTheme === name,
    })),
  ];
}

export function parseProfileLinks(value: string): ProfileLink[] {
  return profileLinkLines(value).map(profileLinkFields);
}

export function profileLinkLineProblem(value: string): string | undefined {
  const bad = profileLinkLines(value).find((line) => !isProfileLink(profileLinkFields(line)));
  if (bad === undefined) return undefined;

  return (
    `A profile link is "Label | URL", or a bare URL that labels itself, one ` +
    `per line, where the URL is ${LINK_URL_RULE}, and may end in ` +
    `${LINK_REL_RULE}. "${bad}" is not one.`
  );
}

function profileLinkLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function profileLinkFields(line: string): ProfileLink {
  const { text, rel } = splitLinkRel(line);
  const carried = rel === '' ? {} : { rel };

  const bar = text.indexOf('|');
  if (bar === -1) return { label: text, href: text, ...carried };
  return { label: text.slice(0, bar).trim(), href: text.slice(bar + 1).trim(), ...carried };
}

function isProfileLink(link: ProfileLink): boolean {
  return link.label !== '' && isLinkUrl(link.href);
}

export function formatProfileLinks(links: readonly ProfileLink[] | undefined): string {
  return (links ?? [])
    .map((link) => {
      const line = link.label === link.href ? link.href : `${link.label} | ${link.href}`;
      return link.rel === undefined || link.rel === '' ? line : `${line} | ${link.rel}`;
    })
    .join('\n');
}

function row(
  user: User,
  context: { signedInAs: number | null; total: number },
): Record<string, unknown> {
  const you = user.id === context.signedInAs;
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? '',
    editUrl: editUserPath(user.id),
    profile: {
      displayName: user.profile?.displayName ?? '',
      bio: user.profile?.bio ?? '',
      avatar: user.profile?.avatar ?? '',
      jobTitle: user.profile?.jobTitle ?? '',
      location: user.profile?.location ?? '',
      links: formatProfileLinks(user.profile?.links),
    },
    archiveUrl: authorHref(user.username),
    storedActorId: user.actorId ?? '',
    notifications: notificationSwitches(user),
    createdAt: user.createdAt,
    you,
    deletable: !you && context.total > 1,
  };
}
