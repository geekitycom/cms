/**
 * Tools > Personal data: erasing one person's data when they ask (TASK-135).
 *
 * WordPress keeps the same job under the same menu. Somebody types the email
 * the person commented or wrote in under, is shown what the site holds for it,
 * and presses the button that erases it. Looking is a step of its own, as a
 * rebuild's confirmation is, because an erasure cannot be undone. The post
 * goes through the admin guard like every other one, so a form on another
 * site cannot press the button for an admin who happens to be signed in.
 */

import type { Context, Hono } from 'hono';

import type { GeekityEnv } from '../env.ts';
import { erasePersonalData, ERASED_NAME, findPersonalData } from '../privacy/erase.ts';
import type { PersonalDataReport, PersonalDataStores } from '../privacy/erase.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { TOOLS_PATH, TOOLS_SECTION } from './tools.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** Where the screen lives, and where both of its forms post. */
export const PERSONAL_DATA_PATH = `${TOOLS_PATH}/personal-data`;

/** The child of Tools it is. */
export const PERSONAL_DATA_CHILD = 'personal-data';

/** The fields the forms submit. */
export const PERSONAL_DATA_FIELDS = {
  /** The address the person commented or wrote in under. */
  email: 'email',
  /** Set once the admin has been shown what an erasure removes. */
  confirm: 'confirm',
} as const;

/** What {@link mountPersonalDataScreen} needs from the admin around it. */
export interface MountPersonalDataOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/** Register Tools > Personal data. */
export function mountPersonalDataScreen(
  app: Hono<GeekityEnv>,
  options: MountPersonalDataOptions,
): void {
  const { render } = options;

  app.get(PERSONAL_DATA_PATH, (c) =>
    render(c, ADMIN_TEMPLATES.toolsPersonalData, screen({ email: '', found: undefined })),
  );

  app.post(PERSONAL_DATA_PATH, async (c) => {
    const body = await c.req.parseBody();
    const email = field(body[PERSONAL_DATA_FIELDS.email]).trim();

    if (email === '') {
      c.status(400);
      return render(c, ADMIN_TEMPLATES.toolsPersonalData, {
        ...screen({ email, found: undefined }),
        problem: 'Type the address to look for.',
      });
    }

    if (field(body[PERSONAL_DATA_FIELDS.confirm]) === '') {
      return render(
        c,
        ADMIN_TEMPLATES.toolsPersonalData,
        screen({ email, found: findPersonalData(storesOf(c), email) }),
      );
    }

    const erased = await erasePersonalData(storesOf(c), email);
    flash(c, 'notice', erasedMessage(erased));
    return c.redirect(PERSONAL_DATA_PATH, 303);
  });
}

/** Everything the screen renders. */
function screen(state: {
  email: string;
  found: PersonalDataReport | undefined;
}): Record<string, unknown> {
  const { found } = state;
  return {
    section: TOOLS_SECTION,
    child: PERSONAL_DATA_CHILD,
    heading: 'Personal data',
    actionUrl: PERSONAL_DATA_PATH,
    fields: PERSONAL_DATA_FIELDS,
    email: state.email,
    erasedName: ERASED_NAME,
    found:
      found === undefined
        ? undefined
        : {
            comments: count(found.comments, 'comment'),
            messages: count(found.messages, 'contact message'),
            optedOut: found.optedOut,
            anything: found.comments > 0 || found.messages > 0 || found.optedOut,
          },
  };
}

/** Where a person's data can be, for this request's site. */
function storesOf(c: Context<GeekityEnv>): PersonalDataStores {
  return {
    records: { admin: c.var.admin, contentDir: c.var.config.contentDir },
    dataDir: c.var.config.dataDir,
  };
}

/** What a finished erasure says on the flash. */
export function erasedMessage(report: PersonalDataReport): string {
  const said =
    `Erased ${count(report.comments, 'comment')} and ` +
    `${count(report.messages, 'contact message')}.`;
  return report.optedOut ? `${said} The address is off the reply opt-out list too.` : said;
}

/** "1 comment", "2 comments". */
function count(howMany: number, singular: string): string {
  return `${String(howMany)} ${howMany === 1 ? singular : `${singular}s`}`;
}

/** One submitted field as a string. */
function field(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
