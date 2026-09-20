import { randomInt } from 'node:crypto';

import type { Hono } from 'hono';

import type { GeekityEnv } from '../env.ts';
import { authorHref } from '../web/authors.ts';
import { isLinkUrl, LINK_URL_RULE, MENU_ITEM_FLAGS } from '../web/navigation.ts';
import {
  DEFAULT_DELIVERY_MODE,
  deliveryMode,
  notificationEvent,
  notificationSwitches,
} from '../notifications/preferences.ts';
import {
  countUsers,
  createUser,
  deleteUser,
  DuplicateUsernameError,
  findUserById,
  listUsers,
  setUserEmail,
  setUserNotification,
  setUserNotificationMode,
  setUserPassword,
  setUserProfile,
  verifyUserPassword,
} from './accounts.ts';
import type { ProfileLink, User } from './accounts.ts';
import { emailProblem, passwordProblem, usernameProblem } from './credentials.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import { toldFollowers } from './settings-page.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** Where the list of users lives. */
export const USERS_PATH = `${ADMIN_PREFIX}/users`;

/**
 * Where the add form lives, and where it posts.
 *
 * A screen of its own rather than a panel under the table, because the menu
 * says Users > Add new and a menu entry has to be somewhere to go. It is also
 * what keeps a refused add on a page about adding somebody instead of at the
 * top of a list of everybody.
 */
export const ADD_USER_PATH = `${USERS_PATH}/new`;

/**
 * Where one user is edited.
 *
 * The split documents.ts already makes between a listing and `basePath/:slug`
 * (TASK-97): the table says who there is, and one screen per person holds
 * every field that person has, each with a label beside it. A row of
 * unlabelled boxes in a table cell could not.
 */
export function editUserPath(id: number): string {
  return `${USERS_PATH}/${String(id)}`;
}

/**
 * The id in `/admin/users/<id>`, or `undefined` for a segment that is not one.
 *
 * Digits only, so `new`, `password` and the other named paths under
 * `/admin/users/` can never be read as somebody's id — and so a URL somebody
 * typed answers 404 rather than `NaN`.
 */
function pathId(segment: string): number | undefined {
  if (!/^\d+$/.test(segment)) return undefined;
  return Number(segment);
}

/** Where the signed-in admin's change-password form posts. */
export const CHANGE_PASSWORD_PATH = `${USERS_PATH}/password`;

/** Where a delete button posts, on the list or on the user's own screen. */
export const DELETE_USER_PATH = `${USERS_PATH}/delete`;

/** Where the email address on the Account panel posts. */
export const USER_EMAIL_PATH = `${USERS_PATH}/email`;

/**
 * Where the Profile panel posts.
 *
 * A path of its own rather than a second half of the email form, because the
 * two are about different audiences: an email address is private to the site
 * and a profile is the public face decision-14 puts at the author URL. One
 * form that saved both would mean an admin correcting a colleague's address
 * also republishing their bio.
 */
export const USER_PROFILE_PATH = `${USERS_PATH}/profile`;

/** Where the notice switches post. */
export const USER_NOTIFICATIONS_PATH = `${USERS_PATH}/notifications`;

/**
 * Where the how-often selects post.
 *
 * A path of its own rather than a second field on the switch, because the two
 * forms answer different questions and a switch is a button while a mode is a
 * select and a Save: one handler that had to work out which of the two it had
 * been given would be guessing at something the URL can simply say.
 */
export const USER_NOTIFICATION_MODE_PATH = `${USER_NOTIFICATIONS_PATH}/mode`;

/** The fields the forms on these screens submit. */
export const USER_FIELDS = {
  username: 'username',
  password: 'password',
  email: 'email',
  generate: 'generate',
  currentPassword: 'current_password',
  newPassword: 'new_password',
  newPasswordConfirmation: 'new_password_confirmation',
  userId: 'user_id',
  /** Which notice a switch is about, by its name in the registry. */
  event: 'event',
  /**
   * Whether that notice is wanted.
   *
   * A checkbox, so a form that turns one off submits nothing at all under this
   * name — which is why the switch is a form of its own per event rather than
   * one form with a checkbox per event: a browser sends no field for an
   * unticked box, and one form could not tell "turned this off" from "did not
   * mention it".
   */
  on: 'on',
  /** How often that notice should arrive, for an event that offers a choice. */
  mode: 'mode',
  /** The name to print instead of the login (TASK-67). */
  displayName: 'display_name',
  /** A few sentences about this person. */
  bio: 'bio',
  /** Their picture, as a path or a URL. */
  avatar: 'avatar',
  /** What they do, printed beside the name in a bio (TASK-79). */
  jobTitle: 'job_title',
  /** Where they are, as they write it. */
  location: 'location',
  /** Somewhere else they are: one `Label | URL` per line. */
  links: 'links',
} as const;

/** What {@link mountUsers} needs from the admin around it. */
export interface MountUsersOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/**
 * Register the users screens: the list, the add form, and one screen per user
 * where everything about that person is edited.
 *
 * The same split documents.ts makes (TASK-97). The table says who there is;
 * a person's own screen holds their email address, their public profile, what
 * they are emailed about, and — where the account can go — the delete. Every
 * save lands back on that screen, so it shows its own result.
 *
 * One thing is still only ever your own: the password. Changing somebody
 * else's is deliberately not offered — resetting a colleague's password from
 * under them is what `geekity user add` and a fresh account are for, and it
 * keeps the current-password check honest.
 */
export function mountUsers(app: Hono<GeekityEnv>, options: MountUsersOptions): void {
  const { render } = options;

  app.get(USERS_PATH, (c) => render(c, ADMIN_TEMPLATES.usersList, screen(c)));

  app.get(ADD_USER_PATH, (c) => render(c, ADMIN_TEMPLATES.usersNew, addScreen(c)));

  app.post(ADD_USER_PATH, async (c) => {
    const body = await c.req.parseBody();
    const username = field(body[USER_FIELDS.username]).trim();
    const supplied = field(body[USER_FIELDS.password]);
    const email = field(body[USER_FIELDS.email]).trim();
    const generate = field(body[USER_FIELDS.generate]) !== '';

    const password = generate ? generatePassword() : supplied;
    const problems = addUserProblems(username, password, generate, email);

    if (Object.keys(problems).length === 0) {
      try {
        await createUser({ dataDir: c.var.config.dataDir, username, password, email });
      } catch (error) {
        if (!(error instanceof DuplicateUsernameError)) throw error;
        problems.username = error.message;
      }
    }

    if (Object.keys(problems).length > 0) {
      c.status(400);
      // Back onto the form that was refused, with what was typed still in it.
      return render(
        c,
        ADMIN_TEMPLATES.usersNew,
        addScreen(c, { addForm: { username, email, generate }, addProblems: problems }),
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
        : findUserById(c.var.config.dataDir, session.userId);
    if (session === undefined || user === undefined) return c.redirect(USERS_PATH, 303);

    const body = await c.req.parseBody();
    const current = field(body[USER_FIELDS.currentPassword]);
    const next = field(body[USER_FIELDS.newPassword]);
    const confirmation = field(body[USER_FIELDS.newPasswordConfirmation]);

    const problems = changePasswordProblems({
      correct: verifyUserPassword(c.var.config.dataDir, user.username, current) !== undefined,
      next,
      confirmation,
    });

    if (Object.keys(problems).length > 0) {
      c.status(400);
      // Back onto your own page, where the form is. Nothing that was typed is
      // echoed back: every field on this form is a password, and a password
      // does not belong in rendered HTML.
      return render(
        c,
        ADMIN_TEMPLATES.usersEdit,
        userScreen(c, user, { passwordProblems: problems }),
      );
    }

    await setUserPassword({ dataDir: c.var.config.dataDir, userId: user.id, password: next });
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
    return c.redirect(editUserPath(user.id), 303);
  });

  /**
   * Put an email address on a user, or take one off.
   *
   * Anybody's, not only your own. There is one role, so every user already has
   * every power there is — including deleting somebody and adding them back —
   * and a screen where an admin could see a colleague's address but not
   * correct a typo in it would be a rule with nothing behind it. It is also
   * what makes a site usable: an admin who has just added a colleague can put
   * their address in without waiting for them to sign in and do it.
   *
   * A flash and a redirect back to that person's screen rather than a 400 with
   * the form redrawn, unlike the two forms above: nothing here is a secret, so
   * there is no reason not to show the refusal beside the box it is about with
   * what is stored back in it.
   */
  app.post(USER_EMAIL_PATH, async (c) => {
    const dataDir = c.var.config.dataDir;
    const body = await c.req.parseBody();
    const id = Number(field(body[USER_FIELDS.userId]));
    const email = field(body[USER_FIELDS.email]).trim();
    const target = Number.isInteger(id) ? findUserById(dataDir, id) : undefined;

    if (target === undefined) {
      flash(c, 'error', 'That user is already gone.');
      return c.redirect(USERS_PATH, 303);
    }

    const problem = emailProblem(email);
    if (problem !== undefined) {
      flash(c, 'error', problem);
      return c.redirect(editUserPath(target.id), 303);
    }

    await setUserEmail({ dataDir, userId: target.id, email });
    flash(
      c,
      'notice',
      email === ''
        ? `${target.username} has no email address any more.`
        : `${target.username} will be emailed at ${email}.`,
    );
    return c.redirect(editUserPath(target.id), 303);
  });

  /**
   * Write a user's public profile (TASK-67).
   *
   * Anybody's, for the reason the email field is anybody's: one role, and an
   * admin who has just added a colleague should be able to put a name and a
   * line about them on their archive without waiting for them to sign in. The
   * whole profile at once, because that is what the panel is — six boxes and
   * one Save — and a box somebody cleared is a field they no longer want.
   *
   * A flash and a redirect for everything but the Links box, because nothing
   * else here can be wrong enough to refuse. A link line that is not a link is
   * refused the way a menu line is (TASK-112): a 400 with the panel redrawn
   * around what was typed, because a link nobody can follow is worse stored
   * than reported, and because the line to fix has to still be there to fix.
   */
  app.post(USER_PROFILE_PATH, async (c) => {
    const dataDir = c.var.config.dataDir;
    const body = await c.req.parseBody();
    const id = Number(field(body[USER_FIELDS.userId]));
    const target = Number.isInteger(id) ? findUserById(dataDir, id) : undefined;

    if (target === undefined) {
      flash(c, 'error', 'That user is already gone.');
      return c.redirect(USERS_PATH, 303);
    }

    const typed = {
      displayName: field(body[USER_FIELDS.displayName]),
      bio: field(body[USER_FIELDS.bio]),
      avatar: field(body[USER_FIELDS.avatar]),
      jobTitle: field(body[USER_FIELDS.jobTitle]),
      location: field(body[USER_FIELDS.location]),
      links: field(body[USER_FIELDS.links]),
    };

    const problem = profileLinkLineProblem(typed.links);
    if (problem !== undefined) {
      c.status(400);
      // Every box comes back holding exactly what was typed into it, the way
      // the Navigation screen's does: a refused save that emptied the panel
      // would cost somebody their bio to report a bad link.
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

    // The profile is the actor's profile now (decision-14), so saving it is
    // also an announcement: a follower's copy of somebody's name, bio and
    // picture is only as fresh as the last `Update` they were sent. The user
    // is read back rather than assumed, so the actor that goes out is built
    // from the file exactly as a peer fetching it would be.
    const saved = changed ? findUserById(dataDir, target.id) : undefined;
    const told = saved === undefined ? undefined : await c.var.delivery.updateActor(saved);

    flash(c, 'notice', `Saved ${target.username}’s profile.${toldFollowers(told)}`);
    return c.redirect(editUserPath(target.id), 303);
  });

  /**
   * Turn one notice on or off for one user.
   *
   * Anybody's, for the reason the email field is anybody's: one role, and an
   * admin who has just given a colleague an address should be able to say what
   * goes to it. An event nothing in this version knows is a no-op rather than an
   * error, because the only way to submit one is a form this CMS did not
   * render.
   */
  app.post(USER_NOTIFICATIONS_PATH, async (c) => {
    const dataDir = c.var.config.dataDir;
    const body = await c.req.parseBody();
    const id = Number(field(body[USER_FIELDS.userId]));
    const target = Number.isInteger(id) ? findUserById(dataDir, id) : undefined;

    if (target === undefined) {
      flash(c, 'error', 'That user is already gone.');
      return c.redirect(USERS_PATH, 303);
    }

    const name = field(body[USER_FIELDS.event]);
    const event = notificationEvent(name);
    if (event === undefined) {
      flash(c, 'error', 'That is not something this site can tell anybody about.');
      return c.redirect(editUserPath(target.id), 303);
    }

    // An unticked checkbox submits no field at all, so its absence is the
    // answer rather than a missing one.
    const on = field(body[USER_FIELDS.on]) !== '';
    await setUserNotification({ dataDir, userId: target.id, event: name, on });

    flash(
      c,
      'notice',
      on
        ? `${target.username} will be emailed about ${event.label.toLowerCase()}.`
        : `${target.username} will not be emailed about ${event.label.toLowerCase()}.`,
    );
    return c.redirect(editUserPath(target.id), 303);
  });

  /**
   * Say how often one notice reaches one user.
   *
   * Anybody's, for the reason the switch beside it is anybody's. A mode this
   * version does not know, or an event that offers no choice, changes nothing
   * and says so: the only way to submit either is a form this CMS did not
   * render.
   */
  app.post(USER_NOTIFICATION_MODE_PATH, async (c) => {
    const dataDir = c.var.config.dataDir;
    const body = await c.req.parseBody();
    const id = Number(field(body[USER_FIELDS.userId]));
    const target = Number.isInteger(id) ? findUserById(dataDir, id) : undefined;

    if (target === undefined) {
      flash(c, 'error', 'That user is already gone.');
      return c.redirect(USERS_PATH, 303);
    }

    const name = field(body[USER_FIELDS.event]);
    const event = notificationEvent(name);
    if (event === undefined || !event.batched) {
      flash(c, 'error', 'That is not a notice this site can batch up.');
      return c.redirect(editUserPath(target.id), 303);
    }

    const wanted = deliveryMode(field(body[USER_FIELDS.mode]));
    if (wanted === undefined) {
      flash(c, 'error', 'That is not one of the choices.');
      return c.redirect(editUserPath(target.id), 303);
    }

    await setUserNotificationMode({ dataDir, userId: target.id, event: name, mode: wanted });

    flash(
      c,
      'notice',
      wanted === DEFAULT_DELIVERY_MODE
        ? `${target.username} will hear about ${event.label.toLowerCase()} as they arrive.`
        : `${target.username} will get one ${wanted === 'daily' ? 'daily' : 'hourly'} digest of ` +
            `${event.label.toLowerCase()}.`,
    );
    return c.redirect(editUserPath(target.id), 303);
  });

  app.post(DELETE_USER_PATH, async (c) => {
    const dataDir = c.var.config.dataDir;
    const body = await c.req.parseBody();
    const id = Number(field(body[USER_FIELDS.userId]));
    const target = Number.isInteger(id) ? findUserById(dataDir, id) : undefined;

    const refusal = deleteUserRefusal({
      target,
      signedInAs: c.var.session?.userId ?? null,
      total: countUsers(dataDir),
    });

    if (refusal !== undefined) {
      flash(c, 'error', refusal);
      return c.redirect(USERS_PATH, 303);
    }

    await deleteUser({ dataDir, userId: (target as User).id });
    // Their sessions go with them. The foreign key that used to do this went
    // with the users table (decision-9), so it is done here — and a session
    // that outlives this one, in a database restored from a backup, is not a
    // login either: the guard refuses one whose user the file does not hold.
    c.var.admin.deleteSessionsForUser((target as User).id);
    flash(c, 'notice', `Deleted ${(target as User).username}.`);
    return c.redirect(USERS_PATH, 303);
  });

  /**
   * One user's screen (TASK-97).
   *
   * Registered last, after every named path under `/admin/users/`, and matched
   * only when the segment is digits — so Add new keeps its URL and a stray
   * `/admin/users/anything` is a 404 rather than a screen about nobody.
   */
  app.get(`${USERS_PATH}/:id`, (c) => {
    const id = pathId(c.req.param('id'));
    const user = id === undefined ? undefined : findUserById(c.var.config.dataDir, id);
    if (user === undefined) return c.notFound();
    return render(c, ADMIN_TEMPLATES.usersEdit, userScreen(c, user));
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
export type AddUserProblems = { username?: string; password?: string; email?: string };

/**
 * What is wrong with a proposed user, one message per field.
 *
 * The rules are the shared ones, so an account made here is one
 * `/admin/setup` and `geekity user add` would both have accepted. A generated
 * password is not checked against them — it is made to satisfy them — and the
 * password field is not read at all when the box is ticked, so a stale value
 * left in it cannot be what is refused. An empty email is not a problem: it is
 * an optional field, and most users will never have one.
 */
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

/**
 * The Add new screen: the same context the listing is drawn from, rendered
 * through `pages/users/new.njk` instead. The two screens are the same chrome
 * around one of two things, and which of them it is is the route's business
 * rather than a flag the template has to read.
 */
function addScreen(
  c: Parameters<AdminRender>[0],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return screen(c, { child: 'new', ...extra });
}

/**
 * Everything one user's screen renders (TASK-97).
 *
 * The same forms the table used to hold, one per panel and each with its
 * fields labelled: the account, the public profile, what this person is
 * emailed about, the password — only on your own page — and the delete, or the
 * sentence saying why this account cannot go.
 */
function userScreen(
  c: Parameters<AdminRender>[0],
  user: User,
  extra: Record<string, unknown> = {},
  /**
   * What was typed into the Profile panel, where a save of it was refused: the
   * boxes are drawn holding this instead of what is stored, so the line to fix
   * is still on the screen and nothing else somebody wrote has been thrown
   * away (TASK-112).
   */
  typedProfile?: Record<string, string>,
): Record<string, unknown> {
  const signedInAs = c.var.session?.userId ?? null;
  const total = countUsers(c.var.config.dataDir);

  return {
    section: 'users',
    // The list's entry stays marked: an edit screen is where a row goes, not a
    // sixth thing in the menu.
    child: 'all',
    usersUrl: USERS_PATH,
    userProfileUrl: USER_PROFILE_PATH,
    changePasswordUrl: CHANGE_PASSWORD_PATH,
    deleteUserUrl: DELETE_USER_PATH,
    userEmailUrl: USER_EMAIL_PATH,
    userNotificationsUrl: USER_NOTIFICATIONS_PATH,
    userNotificationModeUrl: USER_NOTIFICATION_MODE_PATH,
    fields: USER_FIELDS,
    // `account` rather than `user`, which the chrome already holds: the bar
    // says who is signed in, and this screen is about somebody who may well be
    // anybody else.
    account: {
      ...row(user, { signedInAs, total }),
      ...(typedProfile === undefined ? {} : { profile: typedProfile }),
    },
    // Why this account cannot go, where it cannot, so the screen says it
    // instead of offering a button it is about to refuse.
    deleteRefusal: deleteUserRefusal({ target: user, signedInAs, total }),
    passwordProblems: {},
    profileProblems: {},
    mailConfigured: c.var.mail.configured(),
    ...extra,
  };
}

/**
 * Everything the users screens render: the listing, and the fields the add
 * form is drawn from.
 *
 * Nothing about editing a user is here any more (TASK-97). A row says who
 * somebody is and links to their screen; the only form in the table is the
 * delete, which is an action rather than a field.
 */
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

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function field(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * A textarea of links as the list a profile stores: one per line, `Label |
 * URL`, or a bare URL that labels itself.
 *
 * A textarea rather than a repeating fieldset because a profile has two or
 * three links and a table row has no space for a widget; the separator is a
 * pipe because it is the one character nobody puts in a link label by
 * accident. Blank lines are skipped and the empties are dropped inside
 * `setUserProfile`, so a list somebody emptied leaves no key behind.
 */
export function parseProfileLinks(value: string): ProfileLink[] {
  return profileLinkLines(value).map(profileLinkFields);
}

/**
 * What is wrong with a typed list of profile links, or `undefined` when
 * nothing is.
 *
 * The check the box never had (TASK-112). A URL goes through
 * {@link isLinkUrl}, the rule the Navigation screen's menu box already used,
 * so `Elsewhere | not a url` is refused in both places and for the same
 * reason. One message naming the first bad line, for the reason the menu box's
 * message names one: a box is fixed a line at a time, and the line to fix is
 * the useful half of the sentence.
 *
 * A line ending in a menu item's flag gets a sentence of its own, because that
 * is the mistake that was actually made — a line learned from the Navigation
 * screen, typed here, stored whole and served to a reader as
 * `/author/a%20%7C%20me/`. A profile link takes no flags: `partials/bio.njk`
 * renders every one of them with `rel="me"` already, so `| me` here would be
 * either nothing or a way to turn off the only thing this box is for.
 *
 * Tolerant on the way out and strict on the way in: {@link parseProfileLinks}
 * and the file's own reader still take anything, so a link stored before this
 * check existed still renders and still comes back in the box. Refusing a save
 * is not refusing a read.
 */
export function profileLinkLineProblem(value: string): string | undefined {
  const bad = profileLinkLines(value).find((line) => !isProfileLink(profileLinkFields(line)));
  if (bad === undefined) return undefined;

  const withoutFlag = withoutMenuItemFlag(bad);
  if (withoutFlag !== undefined && isProfileLink(profileLinkFields(withoutFlag))) {
    return (
      `Every link on a profile already carries rel="me", so a profile link ` +
      `does not end "| me" the way a menu item does. Take the flag off ` +
      `"${bad}" and it is one.`
    );
  }

  return (
    `A profile link is "Label | URL", or a bare URL that labels itself, one ` +
    `per line, where the URL is ${LINK_URL_RULE}. "${bad}" is not one.`
  );
}

/** The non-empty lines of the Links box, trimmed. A blank line asks for nothing. */
function profileLinkLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * One typed line split where a profile link splits: at its first bar, so a
 * label cannot hold one, and a line with no bar is a URL that labels itself.
 *
 * The split alone, with nothing said about whether what came out is a link:
 * one spelling for the line the box reads back and the line it checks, so the
 * two can never disagree about which half is the URL.
 */
function profileLinkFields(line: string): ProfileLink {
  const bar = line.indexOf('|');
  if (bar === -1) return { label: line, href: line };
  return { label: line.slice(0, bar).trim(), href: line.slice(bar + 1).trim() };
}

/** Whether a split line is a link: somewhere to go, and something to call it. */
function isProfileLink(link: ProfileLink): boolean {
  return link.label !== '' && isLinkUrl(link.href);
}

/**
 * A line with a menu item's flag taken off the end of it, or `undefined` when
 * it does not end in one.
 *
 * Read off {@link MENU_ITEM_FLAGS} rather than spelled out here, so a second
 * flag on the Navigation screen is a flag this box knows to say no to without
 * anybody remembering to come back. What is left is handed back rather than
 * thrown away, because the sentence about a flag is only the right sentence
 * when taking the flag off leaves a link: `Mastodon | me` ends in the word,
 * but the trouble with it is that `me` is not a URL.
 */
function withoutMenuItemFlag(line: string): string | undefined {
  const bar = line.lastIndexOf('|');
  if (bar === -1) return undefined;
  const word = line
    .slice(bar + 1)
    .trim()
    .toLowerCase();
  if (!(MENU_ITEM_FLAGS as readonly string[]).includes(word)) return undefined;
  return line.slice(0, bar).trim();
}

/** A stored list of links back as the textarea shows it. */
export function formatProfileLinks(links: readonly ProfileLink[] | undefined): string {
  return (links ?? [])
    .map((link) => (link.label === link.href ? link.href : `${link.label} | ${link.href}`))
    .join('\n');
}

/** One user, as the table lists them and as their own screen edits them. */
function row(
  user: User,
  context: { signedInAs: number | null; total: number },
): Record<string, unknown> {
  const you = user.id === context.signedInAs;
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? '',
    // Where the row goes, and where every save about this person lands.
    editUrl: editUserPath(user.id),
    // The public half of this person (TASK-67): what the archive at
    // `archiveUrl` is headed with, and — after TASK-68 — what their actor
    // carries.
    profile: {
      displayName: user.profile?.displayName ?? '',
      bio: user.profile?.bio ?? '',
      avatar: user.profile?.avatar ?? '',
      jobTitle: user.profile?.jobTitle ?? '',
      location: user.profile?.location ?? '',
      links: formatProfileLinks(user.profile?.links),
    },
    archiveUrl: authorHref(user.username),
    // The id this person was published under before they were here (TASK-69).
    // Shown on their screen rather than edited: it is identity, not a
    // preference — the import writes it, or somebody editing
    // `data/users.json` does — and a box that let it be changed would be a box
    // that could break every follow this person has. Empty for almost
    // everybody, and then the screen says nothing about it at all.
    storedActorId: user.actorId ?? '',
    // One switch per registered event, so the screen loops rather than naming
    // the notices it happens to know about (TASK-55).
    notifications: notificationSwitches(user),
    createdAt: user.createdAt,
    you,
    // The button is rendered for everybody the signed-in admin may actually
    // delete, so neither screen offers an action it is about to refuse.
    deletable: !you && context.total > 1,
  };
}
