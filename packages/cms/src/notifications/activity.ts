import type { ResolvedConfig } from '../config.ts';
import { immediateRecipients, notificationRecipients } from '../site/notification-preferences.ts';
import { listUsers } from '../site/users.ts';
import type { MailService } from './mail-service.ts';
import { recordNotice, withdrawNotice } from './notice-log.ts';
import type { NoticeItem } from './notice-log.ts';
import { absoluteUrl } from '../util/url.ts';

/**
 * The notices the fediverse sets off that are not comments: a like or a
 * boost, a quote, a new follower.
 *
 * Each is one thing that happened, told the moment the inbox first knows of
 * it. A user who takes the event as it arrives gets one message about it; a
 * user on an hourly or a daily digest has it written to the notice log, which
 * the digest reads when their window comes up. An Undo takes it out of the
 * log by the same key, so a digest that has not gone yet does not list it; a
 * message already sent cannot be recalled.
 */

/** The message a user who takes one of these as it arrives is sent. */
export const FEDIVERSE_NOTICE_TEMPLATE = 'fediverse-notice';

/** Likes and boosts of the site's posts. */
export const REACTIONS_NOTIFICATION = 'reactions';

/** Quotes of the site's posts. */
export const QUOTES_NOTIFICATION = 'quotes';

/** New followers of the site's accounts. */
export const FOLLOWERS_NOTIFICATION = 'followers';

/** Tells people about what the fediverse did. Never throws. */
export interface ActivityNotices {
  /**
   * Whether anybody would be told about this event, so the inbox can skip the
   * work of describing something nobody hears about.
   */
  wanted(event: string): Promise<boolean>;
  /** Something happened: send it to whoever takes it now, log it for the digests. */
  happened(event: string, item: NoticeItem): Promise<void>;
  /** It was undone: take it out of any digest that has not gone yet. */
  undone(event: string, key: string): Promise<void>;
}

export interface CreateActivityNoticesOptions {
  /** The one door out for email. */
  mail: MailService;
  config: Pick<ResolvedConfig, 'baseUrl' | 'dataDir' | 'now'>;
  logger?: Pick<Console, 'warn'> | undefined;
}

export function createActivityNotices(options: CreateActivityNoticesOptions): ActivityNotices {
  const { mail, config } = options;
  const logger = options.logger ?? console;

  // A notice that fails is logged and dropped: the inbox that set it off has
  // already done its work, and a sender retrying the activity because a
  // message could not be written would repeat that work.
  async function safely(what: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      logger.warn(`Could not ${what}:`, error);
    }
  }

  return {
    async wanted(event) {
      return (
        notificationRecipients(listUsers(config.dataDir), event).length > 0 &&
        (await mail.configured())
      );
    },

    happened(event, item) {
      return safely(`send the ${event} notice`, async () => {
        if (!(await mail.configured())) return;

        await recordNotice({ dataDir: config.dataDir, event, item, now: config.now() });

        for (const recipient of immediateRecipients(listUsers(config.dataDir), event)) {
          void mail.send({
            to: recipient.email,
            template: FEDIVERSE_NOTICE_TEMPLATE,
            data: {
              event,
              notice: item,
              settingsUrl: absoluteUrl('/admin/settings/notifications', config.baseUrl),
            },
          });
        }
      });
    },

    undone(event, key) {
      return safely(`withdraw the ${event} notice`, () =>
        withdrawNotice({ dataDir: config.dataDir, event, key }),
      );
    },
  };
}
