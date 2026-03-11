import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PushService } from '../services/push.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';

export function pushRouter(config: AimeatConfig, storage: Storage, pushService: PushService): Router {
  const router = Router();

  // POST /v1/push/subscribe — Register push subscription
  router.post('/v1/push/subscribe', requireAuth(), async (req, res) => {
    try {
      const ownerName = req.auth!.owner;
      const { endpoint, keys } = req.body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing endpoint or keys (p256dh, auth)'));
        return;
      }
      const record = await pushService.subscribe(ownerName, { endpoint, keys });
      res.status(201).json(success(config.nodeId, { subscription: { ownerName: record.ownerName, createdAt: record.createdAt } }, [
        { description: 'Test push notification', method: 'POST', url: '/v1/push/test' },
        { description: 'Unsubscribe', method: 'DELETE', url: '/v1/push/subscribe' },
      ]));
      emitChange('push');
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // DELETE /v1/push/subscribe — Unsubscribe
  router.delete('/v1/push/subscribe', requireAuth(), async (req, res) => {
    try {
      const ownerName = req.auth!.owner;
      const removed = await pushService.unsubscribe(ownerName);
      if (!removed) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No push subscription found'));
        return;
      }
      res.json(success(config.nodeId, { unsubscribed: true }));
      emitChange('push');
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // POST /v1/push/test — Send test notification to self
  router.post('/v1/push/test', requireAuth(), async (req, res) => {
    try {
      const ownerName = req.auth!.owner;
      const ok = await pushService.sendNotification(ownerName, {
        title: 'AIMEAT Test',
        body: 'Push notifications are working!',
        icon: '/icons/icon-192.png',
        url: '/v1/portal/human/dashboard',
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
