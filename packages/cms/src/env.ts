import type { AdminStore } from './admin/store.ts';
import type { Session } from './admin/store.ts';
import type { AvatarService } from './avatars/avatars.ts';
import type { SignedInAccount } from './comments/viewer.ts';
import type { ResolvedConfig } from './config.ts';
import type { Document } from './content/document.ts';
import type { ContentStore } from './content/store.ts';
import type { DocumentChange, SyncResult } from './content/sync.ts';
import type { DeliveryService } from './federation/delivery.ts';
import type { RelayService } from './federation/relays.ts';
import type { MailService } from './mail/service.ts';
import type { MaintenanceSwitch } from './maintenance.ts';
import type { CommentNotifier } from './notifications/comments.ts';
import type { WebmentionService } from './webmention/service.ts';
import type { ConversationReader } from './web/conversation.ts';
import type { RedirectSource } from './web/redirects.ts';
import type { Renderer } from './web/render.ts';

/**
 * What every Hono handler in the CMS can read off the context, so a route
 * never has to be handed the store, the config or the theme by hand.
 */
export interface GeekityEnv {
  Variables: {
    /**
     * Whether the site is in maintenance mode (TASK-130), and until when: the
     * gate in front of the public site and `/healthz` read the same answer.
     */
    maintenance: MaintenanceSwitch;
    /** The derived content index this CMS booted. */
    store: ContentStore;
    /** Users and sessions, the part of the database that is not derived. */
    admin: AdminStore;
    /** Config after defaults and environment overrides. */
    config: ResolvedConfig;
    /** The theme, for handlers that answer with HTML. */
    renderer: Renderer;
    /**
     * What has been said about a post, from every source at once: the thread
     * under it, the counts a feed puts beside it, and the site's latest.
     *
     * On the context because the renderer draws the page from it and the
     * comments feeds are published from it, and the two must be one reading —
     * a subscriber and a reader of the page are looking at the same
     * conversation. Nothing else may read the `comments` or `ap_inbox` index
     * to show one.
     */
    conversation: ConversationReader;
    /**
     * The remote avatars a conversation shows, fetched and served from this
     * site so a reader's browser never asks the server they live on (TASK-134).
     */
    avatars: AvatarService;
    /**
     * Report a write this request made to the content directory.
     *
     * The admin corrects the index as soon as the bytes land rather than
     * waiting for the watcher (doc-1), which means the watcher's later re-read
     * of that file finds a matching hash and emits nothing. A handler that
     * writes therefore has to say so, or no subscriber — a site's
     * `onPublish` hook, the federation's delivery — ever hears about an admin
     * save. The promise resolves once every listener has finished.
     */
    announce: (change: DocumentChange) => Promise<void>;
    /**
     * Walk the content directory once and reconcile every file against the
     * index: the scan `serve()` runs before it listens, on demand.
     *
     * Here so that Tools > Content index can rebuild the index in place
     * (TASK-95) by calling the very scan boot calls, rather than by growing a
     * second thing that knows how to read a content directory. Nothing else in
     * a request has any business asking for one: the watcher keeps the index
     * in step, and an admin write corrects it as it lands.
     */
    rescan: () => Promise<SyncResult>;
    /**
     * Outbound ActivityPub delivery, so a handler can send one post out again
     * as it now reads. The federation screen's Resend button is the whole
     * reason it is here: everything else about delivery happens off the index,
     * away from any request.
     */
    delivery: DeliveryService;
    /**
     * The site's relay subscriptions (FEP-ae0c), so a save of the settings can
     * follow a relay somebody added and unfollow one they took away, and so
     * the federation screen's Retry can send a stuck `Follow` again.
     */
    relays: RelayService;
    /**
     * The site's outgoing webmentions, so the federation screen's Resend
     * button tells the pages a post links to at the same time as it tells the
     * followers. Everything else about sending happens off the index.
     */
    webmentions: WebmentionService;
    /**
     * The site's outgoing email (TASK-53), so a handler can send one: the
     * settings screen's Send test email button, and the password resets,
     * moderation notices and contact messages that come after it.
     *
     * A site with no mail configuration still has one; its `send` is a logged
     * no-op that resolves successfully, so a handler never has to ask first.
     */
    mail: MailService;
    /**
     * Who to tell about a comment (TASK-55): the moderators when one is
     * waiting, and the commenter upthread when a reply to them is approved.
     *
     * On the context because three different handlers set a comment moving —
     * the public form, the moderation screen and the one-click links in the
     * messages themselves — and all three have to tell the same people in the
     * same way. With no mail configured it is a no-op, like the mail service
     * behind it.
     */
    notifications: CommentNotifier;
    /**
     * The redirects the site declares in `content/_data/redirects.json`
     * (TASK-128), read from the file as it is at this request.
     */
    redirects: RedirectSource;
    /**
     * The session this request carries, set by the admin guard: a login, the
     * anonymous session that holds a CSRF token before login, or `undefined`
     * outside `/admin` and for a request whose session has expired.
     */
    session: Session | undefined;
    /**
     * The Content-Security-Policy nonce this admin response's policy names, so
     * a template can put it on a script tag. `undefined` outside `/admin`,
     * where there is no policy to be part of.
     */
    cspNonce: string | undefined;
    /**
     * Who the public site's session names, set once at the public site's door
     * (TASK-183): the page drawn for them carries the admin bar and is theirs
     * alone. `undefined` for an anonymous reader and inside `/admin`.
     */
    signedIn: SignedInAccount | undefined;
    /**
     * The post or page this public HTML response draws, so the admin bar can
     * link to its editor. `undefined` on a listing, a search or an error.
     */
    shownDocument: Document | undefined;
  };
}
