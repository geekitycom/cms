import type { ResolvedConfig } from '../config.ts';
import { immediateRecipients, notificationRecipients } from '../site/notification-preferences.ts';
import { listUsers } from '../site/users.ts';
import type { MailService } from './mail-service.ts';
import { recordNotice, withdrawNotice } from './notice-log.ts';
import type { NoticeItem } from './notice-log.ts';
import { absoluteUrl } from '../util/url.ts';

export const FEDIVERSE_NOTICE_TEMPLATE = 'fediverse-notice';

export const REACTIONS_NOTIFICATION = 'reactions';

export const QUOTES_NOTIFICATION = 'quotes';

export const FOLLOWERS_NOTIFICATION = 'followers';

export interface ActivityNotices {
  wanted(event: string): Promise<boolean>;
  happened(event: string, item: NoticeItem): Promise<void>;
  undone(event: string, key: string): Promise<void>;
}

export interface CreateActivityNoticesOptions {
  mail: MailService;
  config: Pick<ResolvedConfig, 'baseUrl' | 'dataDir' | 'now'>;
  logger?: Pick<Console, 'warn'> | undefined;
}

export function createActivityNotices(options: CreateActivityNoticesOptions): ActivityNotices {
  const { mail, config } = options;
  const logger = options.logger ?? console;

  async function logAndDrop(what: string, work: () => Promise<void>): Promise<void> {
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
      return logAndDrop(`send the ${event} notice`, async () => {
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
      return logAndDrop(`withdraw the ${event} notice`, () =>
        withdrawNotice({ dataDir: config.dataDir, event, key }),
      );
    },
  };
}
