import { Hono } from 'hono';

import { createAccessLog } from '../access-log.ts';
import { baselineSecurityHeaders, mountAdmin } from '../admin/index.ts';
import { createWriteGate } from '../drain.ts';
import type { WriteGate } from '../drain.ts';
import type { GeekityEnv } from '../env.ts';
import { mountFederation } from '../federation/index.ts';
import { mountAuthorizationEndpoint } from '../indieauth/consent.ts';
import { mountIndieAuthDiscovery } from '../indieauth/discovery.ts';
import { mountTokenEndpoint, mountTokenInfoEndpoints } from '../indieauth/token.ts';
import { mountMicropub } from '../micropub/endpoint.ts';
import { mountMicropubMedia } from '../micropub/media.ts';
import { pluginFederation } from '../plugins/federation.ts';
import { mountPluginRoutes, pluginLifecycle } from '../plugins/mount.ts';
import { leavingWriteGate } from '../supervisor/supervision.ts';
import type { Supervision } from '../supervisor/supervision.ts';
import { compression } from '../web/compression.ts';
import {
  maintenanceGate,
  mountHealth,
  mountPublicSite,
  mountWellKnown,
  redirectBy,
  serverError,
} from '../web/index.ts';
import type { Booted } from './boot.ts';
import type { Services } from './services.ts';

/** The Hono app every request goes through, and the gate a drain closes on its writes. */
export function createApp(
  { resolved, plugins, store, admin }: Booted,
  services: Services,
  supervision: Supervision | undefined,
): { app: Hono<GeekityEnv>; writes: WriteGate } {
  const { content, federation } = services;
  const app = new Hono<GeekityEnv>();

  // A handler that throws is answered here rather than with Hono's plain-text
  // 500. The middleware above the handler still runs on the way out, so the
  // baseline and admin headers land on this response like any other.
  app.onError(serverError);

  // One line per request, before anything else is registered so that every
  // route is on it: /healthz, the federation endpoints, the admin and the
  // public site alike, and a request whose handler threw as well. Off unless
  // the site asked for it; `geekity serve` asks.
  if (resolved.accessLog) {
    app.use(
      '*',
      createAccessLog({
        config: resolved,
        ...(resolved.accessLogWriter === undefined ? {} : { write: resolved.accessLogWriter }),
      }),
    );
  }

  // Outside everything after it, so it compresses the body the client is
  // about to get, the error pages and the 503 included (TASK-139).
  if (resolved.compression) app.use('*', compression());

  const writes = createWriteGate();
  app.use('*', writes.middleware);

  app.use('*', async (c, next) => {
    c.set('store', store);
    c.set('admin', admin);
    c.set('config', resolved);
    c.set('renderer', services.renderer);
    c.set('conversation', services.conversation);
    c.set('avatars', services.avatars);
    c.set('actorProfiles', services.actorProfiles);
    c.set('announce', (change) => content.announce(change));
    c.set('rescan', () => content.sync());
    c.set('delivery', services.delivery);
    c.set('relays', services.relays);
    c.set('webmentions', services.webmentions);
    c.set('replyContexts', services.replyContexts);
    c.set('learnHandles', services.learnHandles);
    c.set('mail', services.mail);
    c.set('notifications', services.notifications);
    c.set('redirects', services.redirects);
    c.set('maintenance', services.maintenance);
    c.set('indieauth', services.indieauth);
    c.set(
      'supervision',
      leavingWriteGate(supervision, () => writes.leave(c)),
    );
    await next();
  });

  app.use(
    '*',
    pluginLifecycle(plugins, () => writes.refusing),
  );

  // The baseline on everything the CMS answers, admin and public alike, and
  // outside everything below so redirects, the 503, 404s and the onError 500
  // carry it too. The admin sets stricter values of its own inside it; none of
  // it restricts what a theme may reference.
  app.use('*', baselineSecurityHeaders);

  // And one on every redirect, whichever part of the CMS sent it.
  app.use('*', redirectBy);

  // Maintenance mode (TASK-130) turns away everything after it but the health
  // checks, the admin and the theme's files, so it goes in front of all of
  // them: federation's inboxes included.
  app.use('*', maintenanceGate);

  app.get('/_geekity/health', (c) => c.json({ status: 'ok' }));

  // The health check a container orchestrator or an uptime monitor probes
  // (TASK-87). It goes on before federation, the admin and the public site,
  // so no permalink can ever shadow it.
  mountHealth(app);

  // The two well-known files a site answers for itself (TASK-133), before the
  // public site can claim either path as a permalink.
  mountWellKnown(app);

  // IndieAuth's authorization server metadata (TASK-157), the endpoint that
  // starts a sign-in (TASK-158), the one that issues tokens (TASK-160) and
  // the ones that answer for a token once issued (TASK-161), here for the
  // reason the well-known files are.
  mountIndieAuthDiscovery(app);
  mountAuthorizationEndpoint(app);
  mountTokenEndpoint(app);
  mountTokenInfoEndpoints(app);
  // Micropub (TASK-163) and its media endpoint (TASK-165), which stand on
  // those tokens.
  mountMicropub(app);
  mountMicropubMedia(app);

  // Federation goes on first. It answers its own paths and falls through on
  // every other, so putting it in front costs the rest of the app nothing and
  // is the only place it can go: the public site claims every unmatched path
  // in its not-found handler.
  mountFederation(app, federation, {
    plugins: pluginFederation({
      registry: plugins,
      canonical: federation,
      kv: services.federationKv,
      allowPrivateAddress: resolved.federation.allowPrivateAddress ?? false,
    }),
  });

  // The admin goes on before the public site, for the same reason.
  mountAdmin(app);
  mountPluginRoutes(app, plugins);
  mountPublicSite(app);

  return { app, writes };
}
