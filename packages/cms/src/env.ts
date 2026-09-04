import type { AdminStore } from './admin/store.ts';
import type { Session } from './admin/store.ts';
import type { ResolvedConfig } from './config.ts';
import type { ContentStore } from './content/store.ts';
import type { DocumentChange } from './content/sync.ts';
import type { DeliveryService } from './federation/delivery.ts';
import type { RelayService } from './federation/relays.ts';
import type { Renderer } from './web/render.ts';

/**
 * What every Hono handler in the CMS can read off the context, so a route
 * never has to be handed the store, the config or the theme by hand.
 */
export interface GeekityEnv {
  Variables: {
    /** The derived content index this CMS booted. */
    store: ContentStore;
    /** Users and sessions, the part of the database that is not derived. */
    admin: AdminStore;
    /** Config after defaults and environment overrides. */
    config: ResolvedConfig;
    /** The theme, for handlers that answer with HTML. */
    renderer: Renderer;
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
     * Outbound ActivityPub delivery, so a handler can send a recorded activity
     * again. The federation screen's Redeliver button is the whole reason it is
     * here: everything else about delivery happens off the index, away from any
     * request.
     */
    delivery: DeliveryService;
    /**
     * The site's relay subscriptions (FEP-ae0c), so a save of the settings can
     * follow a relay somebody added and unfollow one they took away, and so
     * the federation screen's Retry can send a stuck `Follow` again.
     */
    relays: RelayService;
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
  };
}
