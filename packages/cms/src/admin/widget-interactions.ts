import { postLabel } from '../content/post-type.ts';
import { readObjectIds } from '../federation/object-ids.ts';
import type { PluginScreenCell } from '../plugin.ts';
import type { LatestInteraction, PostComment } from '../store/admin-store.ts';
import { actorHandle, guessedName } from '../store/inbox-replies.ts';
import { COMMENTS_PATH } from './comments.ts';
import { FEDERATION_PATH, localPosts } from './federation.ts';
import { formatShortTime } from './formatting.ts';
import type { CoreWidget } from './widgets.ts';

export const RECENT_INTERACTIONS = 10;

const INBOX_OVERREAD_FOR_OTHER_PEOPLES_POSTS = 4;

interface Entry {
  readonly at: string;
  readonly who: string;
  readonly what: PluginScreenCell;
}

const FEDIVERSE_KINDS: Readonly<Record<LatestInteraction['kind'], string>> = {
  like: 'Fediverse like of',
  boost: 'Fediverse boost of',
  reply: 'Fediverse reply to',
};

const WEBMENTION_KINDS: Readonly<Record<PostComment['kind'], string>> = {
  reply: 'Webmention reply to',
  like: 'Webmention like of',
  boost: 'Webmention repost of',
  repost: 'Webmention repost of',
  mention: 'Mention of',
};

export const INTERACTIONS_WIDGET: CoreWidget = {
  id: 'recent-interactions',
  title: 'Recent interactions',
  width: 'half',
  refreshSeconds: 60,
  load(vars) {
    const { admin, store } = vars;
    const timezone = vars.siteAtRequestStart.timezone;
    const cited = (url: string) => vars.replyContexts.read(url, vars.siteAtRequestStart);
    const followers = admin.listFollowers();
    const names = new Map(
      followers.map((follower) => [follower.actorId, follower.name ?? follower.handle]),
    );
    const nameOf = (actorId: string): string => {
      const profile = admin.getActorProfile(actorId);
      return (
        names.get(actorId) ??
        profile?.name ??
        profile?.handle ??
        actorHandle(actorId) ??
        guessedName(actorId)
      );
    };

    const comments = admin
      .listLatestCommentsExceptImportedFediverse(RECENT_INTERACTIONS)
      .map((comment): Entry => {
        const document = store.getBySlug(comment.slug);
        const kind =
          comment.source === 'webmention' ? WEBMENTION_KINDS[comment.kind] : 'Comment on';
        const title = document === undefined ? comment.slug : postLabel(document, cited);
        return {
          at: comment.submitted,
          who: comment.author.name,
          what: {
            text: `${kind} ${title}${comment.status === 'pending' ? ', waiting' : ''}`,
            href: `${COMMENTS_PATH}?status=${comment.status}#comment-${comment.id}`,
          },
        };
      });

    const post = localPosts(
      store,
      vars.config.baseUrl,
      readObjectIds(vars.config.contentDir),
      cited,
      (url) => vars.conversation.documentOf(url),
    );
    const fediverse = admin
      .listLatestInteractions(RECENT_INTERACTIONS * INBOX_OVERREAD_FOR_OTHER_PEOPLES_POSTS)
      .flatMap((interaction): Entry[] => {
        const about = post(interaction.about);
        if (about === null) return [];
        return [
          {
            at: interaction.receivedAt,
            who: nameOf(interaction.actorId),
            what: {
              text: `${FEDIVERSE_KINDS[interaction.kind]} ${about.title}`,
              href: about.editUrl,
            },
          },
        ];
      });

    const follows = followers.slice(0, RECENT_INTERACTIONS).map((follower): Entry => ({
      at: follower.followedAt,
      who: follower.name ?? follower.handle ?? guessedName(follower.actorId),
      what: { text: 'New follower', href: FEDERATION_PATH },
    }));

    const entries = [...comments, ...fediverse, ...follows]
      .toSorted((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, RECENT_INTERACTIONS);

    if (entries.length === 0) {
      return [{ paragraph: ['No comments, mentions, reactions or new followers yet.'] }];
    }
    return [
      {
        table: {
          caption: 'The newest interactions',
          columns: ['Who', 'What', 'When'],
          rows: entries.map((entry) => [
            entry.who,
            entry.what,
            formatShortTime(entry.at, timezone),
          ]),
        },
      },
    ];
  },
};
