/**
 * Where the CMS reads the time from.
 *
 * `createCms` builds one from its `now` option and hands it to every service
 * that stamps or compares an instant, so a test that pins it pins them all.
 */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
