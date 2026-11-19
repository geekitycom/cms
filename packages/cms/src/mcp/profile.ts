import { LINK_URL_RULE, isLinkUrl } from '../site/navigation.ts';
import { editUserProfile, isAvatarUrl, profileVersion } from '../site/users.ts';
import type { User, UserProfile } from '../site/users.ts';
import type { FromSchema } from '../util/json-schema.ts';
import { READ_ONLY } from './inspect/schemas.ts';
import { defineTool, refused } from './tools.ts';

const LINK = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'What the link says. The URL when left out.' },
    href: { type: 'string', description: 'Where it goes.' },
    rel: { type: 'string', description: 'Extra rel values, such as "me". Optional.' },
  },
  required: ['href'],
  additionalProperties: false,
} as const;

const FIELDS = {
  displayName: { type: 'string', description: 'The name printed instead of the username.' },
  givenName: { type: 'string' },
  familyName: { type: 'string' },
  bio: { type: 'string', description: 'A few sentences about you, in Markdown.' },
  avatar: {
    type: 'string',
    description: 'A picture, as a path on this site like /media/me.jpg or an http(s) URL.',
  },
  jobTitle: { type: 'string' },
  location: { type: 'string' },
  links: {
    type: 'array',
    items: LINK,
    description: 'Somewhere else you are, in order. A list given replaces the whole list.',
  },
} as const;

const VERSION = {
  type: 'string',
  description: 'The version read. Pass it to update_profile.',
} as const;

const PROFILE_OUTPUT = {
  type: 'object',
  properties: { username: { type: 'string' }, ...FIELDS, version: VERSION },
  required: ['username', 'version'],
} as const;

const TEXT_FIELDS = [
  'displayName',
  'givenName',
  'familyName',
  'bio',
  'avatar',
  'jobTitle',
  'location',
] as const;

function profileAnswer(user: User): FromSchema<typeof PROFILE_OUTPUT> {
  const { profile } = user;
  const text = Object.fromEntries(
    TEXT_FIELDS.flatMap((field) => {
      const value = profile?.[field];
      return value === undefined ? [] : [[field, value]];
    }),
  ) as { readonly [F in (typeof TEXT_FIELDS)[number]]?: string };
  const links = profile?.links?.map(({ label, href, rel }) => ({
    label,
    href,
    ...(rel === undefined ? {} : { rel }),
  }));
  return {
    username: user.username,
    ...text,
    ...(links === undefined ? {} : { links }),
    version: profileVersion(profile),
  };
}

export const getProfile = defineTool({
  name: 'get_profile',
  title: 'Read your profile',
  description:
    'Your own profile on this site: display name, given and family name, bio, avatar, job title, location and links. A field you have not filled in is left out. Returns the version update_profile needs, so an edit fails rather than overwrites when the profile changed in between.',
  scope: 'update',
  annotations: READ_ONLY,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: PROFILE_OUTPUT,
  run: (_args, { user }) =>
    Promise.resolve({
      ok: true,
      summary: `The profile of ${user.username}.`,
      structured: profileAnswer(user),
    }),
});

function profileProblems(changes: UserProfile): string[] {
  const avatar = changes.avatar?.trim() ?? '';
  const badLinks = (changes.links ?? []).filter((link) => !isLinkUrl(link.href.trim()));
  return [
    ...(avatar === '' || isAvatarUrl(avatar)
      ? []
      : [`An avatar is ${LINK_URL_RULE}. "${avatar}" is not one.`]),
    ...badLinks.map((link) => `A link's href is ${LINK_URL_RULE}. "${link.href}" is not one.`),
  ];
}

export const updateProfile = defineTool({
  name: 'update_profile',
  title: 'Edit your profile',
  description:
    'Change the named fields of your own profile and leave the others as they are. An empty string clears a field and an empty links list clears the links. Read the profile with get_profile first and pass its version: when the profile changed since, nothing is written. A change is sent to your followers as an Update.',
  scope: 'update',
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      version: { type: 'string', description: 'The version get_profile returned.' },
      ...FIELDS,
    },
    required: ['version'],
    additionalProperties: false,
  },
  outputSchema: PROFILE_OUTPUT,
  run: async ({ version, links, ...fields }, { user, site }) => {
    const changes: UserProfile = {
      ...fields,
      ...(links === undefined
        ? {}
        : { links: links.map((link) => ({ ...link, label: link.label ?? '' })) }),
    };
    if (Object.keys(changes).length === 0) return refused('Name a field to change.');
    const problems = profileProblems(changes);
    if (problems.length > 0) return refused(problems.join(' '));

    const edit = await editUserProfile({
      dataDir: site.config.dataDir,
      userId: user.id,
      version,
      changes,
    });
    if (edit.outcome === 'stale') {
      return refused(
        'Your profile changed since it was read. Read it again with get_profile and update from what it holds now.',
      );
    }
    const report = edit.changed ? await site.delivery.updateActor(edit.user) : undefined;
    const told = report?.deliveries.length ?? 0;
    return {
      ok: true,
      summary: `${edit.changed ? 'Saved' : 'Nothing changed in'} the profile of ${user.username}.${told === 0 ? '' : ` ${String(told)} followers were told.`}`,
      structured: profileAnswer(edit.user),
    };
  },
});
