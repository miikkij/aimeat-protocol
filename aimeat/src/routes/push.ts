/**
 * @file push.ts
 * @description Web-push subscription routes: register a device for the caller's owner, remove one
 *   device or all of them, send a self-targeted test notification, and expose the public VAPID key
 *   for client subscription.
 * @structure
 *   - POST   /v1/push/subscribe  — register one browser push subscription (device)
 *   - DELETE /v1/push/subscribe  — remove that device (`endpoint`), or every device of the owner
 *   - POST   /v1/push/test       — send a test push to the caller (deep-links to the Notifications tab)
 *   - GET    /v1/push/vapid-key  — public VAPID key (no auth)
 * @usage app.use(pushRouter(config, storage, pushService));
 * @version-history
 *   v1.2.0 — 2026-08-11 — Security audit H-8: the three mutating routes require the `push:manage`
 *     scope, and DELETE can name one device instead of clearing the account.
 *   v1.1.0 — 2026-08-10 — Security audit H-8: the subscription endpoint goes through validateOutboundUrl.
 *     It is a URL the node POSTs every notification to, unattended, and it was stored verbatim.
 *   v1.0.0 — 2026-04-15 — Initial push subscription routes.
 *   v1.1.0 — 2026-07-02 — Test push deep-links to /v1/profile?tab=notifications (the old
 *     /v1/portal/human/dashboard target never existed as a route).
 */
import { Router } from 'express';
import type { Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PushService } from '../services/push.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';

/**
 * SECURITY (audit H-8), and the reason this word is new rather than an existing one.
 *
 * These three routes decide where the person's notifications go. A subscription is an address the
 * node POSTs the body of every notification to, so a principal that can subscribe can read the
 * person's notification stream from then on. Until 2026-08-11 the routes carried requireAuth() and
 * nothing else, which put them inside reach of every agent token, every ecosystem app and every
 * app-grant token issued for the account.
 *
 * `notifications:send` was the near-miss candidate and is the wrong word: it says an app may PUSH a
 * message to the person, and an app that may speak to someone must not thereby be able to read
 * everything else spoken to them. So this is its own permission, in its own domain, and no existing
 * wildcard except `*` covers it.
 *
 * NOT GRANDFATHERED, deliberately, against the rule that a new required scope is handed to existing
 * agents at boot (services/scope-vocabulary-migration.ts, changelog 1.33.1). That rule protects a
 * capability agents actually exercise. This one they cannot: a push subscription is issued by a push
 * service to a browser's service worker, no MCP tool or liaison package reaches these routes, and an
 * agent that registers an endpoint here is performing the finding rather than doing its work. The
 * owner's own browser is unaffected either way, because requireScope lets an owner-role session
 * through on its role. An agent that genuinely needs this can be granted the word by its owner.
 */
const PUSH_SCOPE = 'push:manage';

/**
 * Which device the caller means. A client that knows which one it is names the endpoint, in the body
 * or the query. One that names nothing clears the whole account, which is what the routes did before
 * they were per-device: today the profile page sends no endpoint, so its Turn-off button still means
 * "sign every device out" until it passes one.
 */
function requestedEndpoint(req: Request): string | undefined {
  const fromBody = (req.body as { endpoint?: unknown } | undefined)?.endpoint;
  if (typeof fromBody === 'string' && fromBody) return fromBody;
  const fromQuery = req.query.endpoint;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
  return undefined;
}

export function pushRouter(config: AimeatConfig, storage: Storage, pushService: PushService): Router {
  const router = Router();

  // POST /v1/push/subscribe — Register push subscription
  router.post('/v1/push/subscribe', requireAuth(), requireScope(PUSH_SCOPE), async (req, res) => {
    try {
      // The owner claim of the caller's own token. Push rows are owner-scoped (one person, many
      // devices) rather than GHII-scoped, so this is the account layer on purpose; it is never read
      // from the request body, which is what keeps one principal out of another's stream.
      const ownerName = req.auth!.owner;
      const { endpoint, keys } = req.body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing endpoint or keys (p256dh, auth)'));
        return;
      }
      // SECURITY (audit H-8): the endpoint is a URL this node will POST to, repeatedly, unattended,
      // with the body of every notification the owner receives. It was stored verbatim, so the
      // subscribe route was an unvalidated outbound target: point it at an internal address and the
      // node reaches it on the caller's behalf. Same guard as every other non-constant outbound URL.
      const endpointCheck = await validateOutboundUrl(String(endpoint));
      if (!endpointCheck.valid) {
        res.status(400).json(error(config.nodeId, 'INVALID_ENDPOINT',
          `That push endpoint is not a valid destination: ${endpointCheck.reason}`));
        return;
      }
      const record = await pushService.subscribe(ownerName, { endpoint, keys });
      res.status(201).json(success(config.nodeId, {
        subscription: { ownerName: record.ownerName, endpoint: record.endpoint, createdAt: record.createdAt },
      }, [
        { description: 'Test push notification', method: 'POST', url: '/v1/push/test' },
        { description: 'Unsubscribe this device', method: 'DELETE', url: '/v1/push/subscribe' },
      ]));
      emitChange('push');
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // DELETE /v1/push/subscribe — Unsubscribe one device, or all of them
  router.delete('/v1/push/subscribe', requireAuth(), requireScope(PUSH_SCOPE), async (req, res) => {
    try {
      const ownerName = req.auth!.owner;
      const endpoint = requestedEndpoint(req);
      const removed = await pushService.unsubscribe(ownerName, endpoint);
      if (!removed) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No push subscription found'));
        return;
      }
      res.json(success(config.nodeId, { unsubscribed: true, endpoint: endpoint ?? null }));
      emitChange('push');
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // POST /v1/push/test — Send test notification to self (every registered device)
  router.post('/v1/push/test', requireAuth(), requireScope(PUSH_SCOPE), async (req, res) => {
    try {
      const ownerName = req.auth!.owner;
      const ok = await pushService.sendNotification(ownerName, {
        title: 'AIMEAT Test',
        body: 'Push notifications are working!',
        icon: '/icons/icon-192.png',
        url: '/v1/profile?tab=notifications',
        tag: 'test',
      });
      if (!ok) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No push subscription found or notification failed'));
        return;
      }
      res.json(success(config.nodeId, { sent: true }));
      emitChange('push');
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // GET /v1/push/vapid-key — Public VAPID key for client subscription
  router.get('/v1/push/vapid-key', (_req, res) => {
    if (!config.vapidPublicKey) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Push notifications not configured'));
      return;
    }
    res.json(success(config.nodeId, { vapidPublicKey: config.vapidPublicKey }));
  });

  return router;
}
