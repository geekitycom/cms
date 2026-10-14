import { locationOf } from './location.ts';
import type { PostLocation } from './location.ts';
import { LOCATIONS } from '../files/data-files.ts';
import { permalinkFile } from './permalink-file.ts';
import type { PermalinkFile } from './permalink-file.ts';

export type PostLocations = PermalinkFile<PostLocation>;

export function postLocations(dataDir: string): PostLocations {
  return permalinkFile(dataDir, LOCATIONS, locationOf);
}
