/**
 * The notify server a site advertises and pings when it has not said
 * otherwise: the one this CMS's author runs, which speaks both rssCloud and
 * WebSub, so one server covers every real-time subscriber a feed has.
 */
export const DEFAULT_NOTIFY_SERVER = 'https://rpc.rsscloud.io';

/**
 * The periods the RSS Syndication module lets a feed name, from
 * https://web.resource.org/rss/1.0/modules/syndication/.
 */
export const UPDATE_PERIODS = ['hourly', 'daily', 'weekly', 'monthly', 'yearly'] as const;

/** One of {@link UPDATE_PERIODS}. */
export type UpdatePeriod = (typeof UPDATE_PERIODS)[number];

/** Whether a value is an {@link UpdatePeriod}. */
export function isUpdatePeriod(value: unknown): value is UpdatePeriod {
  return (UPDATE_PERIODS as readonly unknown[]).includes(value);
}

/** How often an RSS feed tells a reader to poll it: `frequency` times a `period`. */
export interface FeedCadence {
  period: UpdatePeriod;
  /** A whole number of polls per period, at least one. */
  frequency: number;
}

/**
 * The cadence a feed declares when the site has not said: once an hour, which
 * is what WordPress declares, so the subscribers of a migrated site keep
 * polling the way they always have.
 */
export const DEFAULT_FEED_CADENCE: FeedCadence = { period: 'hourly', frequency: 1 };
