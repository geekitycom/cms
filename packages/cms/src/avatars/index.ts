export {
  AVATAR_DIRECTORY,
  AVATAR_FETCH_TIMEOUT_MS,
  AVATAR_FIRST_VIEW_WAIT_MS,
  AVATAR_MAX_AGE_MS,
  AVATAR_MAX_BYTES,
  AVATAR_PATH_PREFIX,
  AVATAR_RETRY_MS,
  AVATAR_SIZE,
  AVATAR_SWEEP_MS,
  avatarHref,
  avatarSourceOf,
  createAvatarService,
} from './avatars.ts';
export type {
  AvatarAnswer,
  AvatarLogger,
  AvatarService,
  CreateAvatarServiceOptions,
} from './avatars.ts';
export { mountAvatars } from './routes.ts';
