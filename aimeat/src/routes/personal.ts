import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, MailboxItemRecord, NotificationPreferences } from '../storage/interface.js';
import type { TunnelManager } from '../services/personal-tunnel.js';
import type { MailboxNotificationService } from '../services/mailbox-notification.js';
import { isAllowedPushEndpoint } from '../services/mailbox-notification.js';
import { MailboxService } from '../services/mailbox.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { AnchorRequestSchema, VisibilityUpdateSchema, validateBody } from '../models/schemas.js';
import { logger } from '../utils/logger.js';

export function personalRouter(
  config: AimeatConfig,
  storage: Storage,
  tunnelManager: TunnelManager | null,
  notificationService?: MailboxNotificationService | null,
): Router {
  const router = Router();
  const mailboxService = new MailboxService(config, storage);

  // POST /v1/personal/anchor — Register a personal node with this operator
  router.post('/v1/personal/anchor', requireAuth(), requireRole('owner'), requireScope('tunnel:connect'), validateBody(AnchorRequestSchema, config.nodeId), async (req, res) => {
    try {
      if (!config.personalNodesEnabled) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Personal node support is disabled on this node'));
        return;
      }

      const { node_id, owner_name, public_key, agent_gaiis, visibility } = (req as any).validated;
      const ownerFromAuth = req.auth!.owner;

      // Verify the requesting owner matches
      if (owner_name !== ownerFromAuth) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only anchor personal nodes for your own owner identity'));
        return;
      }

      // Check if already registered
      const existing = await storage.getPersonalNode(node_id);
      if (existing) {
        res.status(409).json(error(config.nodeId, 'CONFLICT', `Personal node ${node_id} is already anchored`));
        return;
      }

      // Check slot availability
      const allNodes = await storage.listPersonalNodes();
      if (allNodes.length >= config.personalNodeMaxSlots) {
        res.status(503).json(error(config.nodeId, 'CAPACITY_FULL', `This operator has reached the maximum of ${config.personalNodeMaxSlots} personal node slots`));
        return;
      }

      const now = new Date().toISOString();
      const record = await storage.createPersonalNode({
        nodeId: node_id,
        ownerName: owner_name,
        anchorNodeId: config.nodeId,
        publicKey: public_key,
        status: 'offline',
        agentGaiis: agent_gaiis ?? [],
        lastSeen: now,
        mailboxQuotaBytes: config.personalNodeMailboxQuotaMb * 1024 * 1024,
        mailboxUsedBytes: 0,
        visibility: visibility ?? 'private',
        createdAt: now,
        updatedAt: now,
      });

      const tunnelUrl = config.baseUrl.replace(/^http/, 'ws') + '/v1/personal/tunnel';

      res.status(201).json(success(config.nodeId, {
        node_id: record.nodeId,
        anchor_operator: config.nodeId,
        status: record.status,
        tunnel_url: tunnelUrl,
        mailbox_quota_bytes: record.mailboxQuotaBytes,
        created_at: record.createdAt,
        visibility: record.visibility,
      }, [
        {
          description: 'Connect via WebSocket tunnel',
          method: 'GET',
          url: tunnelUrl,
        },
        {
          description: 'Check personal node status',
          method: 'GET',
          url: '/v1/personal/status',
        },
      ]));
      emitChange('personal');
    } catch (err) {
      logger.error('Failed to anchor personal node', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to register personal node'));
    }
  });

  // GET /v1/personal/status — Check personal node status (by owner)
  router.get('/v1/personal/status', requireAuth(), requireRole('owner'), requireScope('tunnel:connect'), async (req, res) => {
    try {
      const ownerName = req.auth!.owner;
      const node = await storage.getPersonalNodeByOwner(ownerName);
      if (!node) {
        // Soft read: the profile Nodes tab polls this on load and "no node anchored" is the
        // normal state for most owners. ?soft=1 returns a 200 { anchored: false } instead of
        // a 404 so it doesn't spam the browser console. Default stays 404 (RFC/test contract).
        if (req.query.soft) {
          res.json(success(config.nodeId, { anchored: false, node_id: null }));
          return;
        }
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No personal node anchored for this owner'));
        return;
      }

      const mailboxStats = await mailboxService.getStats(node.nodeId);
      const isConnected = tunnelManager?.isOnline(node.nodeId) ?? false;

      res.json(success(config.nodeId, {
        node_id: node.nodeId,
        anchor_operator: node.anchorNodeId,
        status: isConnected ? 'online' : node.status,
        agent_gaiis: node.agentGaiis,
        visibility: node.visibility,
        last_seen: node.lastSeen,
        mailbox: {
          items: mailboxStats.count,
          used_bytes: mailboxStats.totalBytes,
          quota_bytes: node.mailboxQuotaBytes,
        },
        created_at: node.createdAt,
      }, [
        {
          description: 'Deregister this personal node',
          method: 'DELETE',
          url: `/v1/personal/anchor/${encodeURIComponent(node.nodeId)}`,
        },
      ]));
    } catch (err) {
      logger.error('Failed to get personal node status', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get personal node status'));
    }
  });

  // GET /v1/personal/nodes — List all anchored personal nodes (operator only)
  router.get('/v1/personal/nodes', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const statusFilter = req.query.status as string | undefined;
      const nodes = await storage.listPersonalNodes(statusFilter ? { status: statusFilter } : undefined);

      const results = await Promise.all(nodes.map(async (node) => {
        const stats = await mailboxService.getStats(node.nodeId);
        const isConnected = tunnelManager?.isOnline(node.nodeId) ?? false;
        return {
          node_id: node.nodeId,
          owner_name: node.ownerName,
          visibility: node.visibility,
          status: isConnected ? 'online' : node.status,
          agent_count: node.agentGaiis.length,
          last_seen: node.lastSeen,
          mailbox_items: stats.count,
          mailbox_bytes: stats.totalBytes,
          created_at: node.createdAt,
        };
      }));

      res.json(success(config.nodeId, {
        personal_nodes: results,
        total: results.length,
        max_slots: config.personalNodeMaxSlots,
        available_slots: config.personalNodeMaxSlots - results.length,
      }));
    } catch (err) {
      logger.error('Failed to list personal nodes', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list personal nodes'));
    }
  });

  // PATCH /v1/personal/anchor/:nodeId — Update personal node settings (visibility)
  // Note: operators can also update any personal node (consistent with DELETE pattern)
  router.patch('/v1/personal/anchor/:nodeId', requireAuth(), requireRole('owner'), requireScope('tunnel:connect'), validateBody(VisibilityUpdateSchema, config.nodeId), async (req, res) => {
    try {
      const nodeId = req.params.nodeId as string;
      const ownerName = req.auth!.owner;

      const node = await storage.getPersonalNode(nodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${nodeId} not found`));
        return;
      }

      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only update your own personal nodes'));
        return;
      }

      const { visibility } = (req as any).validated;

      const updated = await storage.updatePersonalNode(nodeId, { visibility });

      res.json(success(config.nodeId, {
        node_id: updated!.nodeId,
        visibility: updated!.visibility,
        updated_at: updated!.updatedAt,
      }));
      emitChange('personal');
    } catch (err) {
      logger.error('Failed to update personal node', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to update personal node'));
    }
  });

  // DELETE /v1/personal/anchor/:nodeId — Deregister personal node
  router.delete('/v1/personal/anchor/:nodeId', requireAuth(), requireRole('owner'), requireScope('tunnel:connect'), async (req, res) => {
    try {
      const nodeId = req.params.nodeId as string;
      const ownerName = req.auth!.owner;

      const node = await storage.getPersonalNode(nodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${nodeId} not found`));
        return;
      }

      // Verify ownership (unless operator)
      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only deregister your own personal nodes'));
        return;
      }

      // Clean up: flush mailbox, close tunnel connection, delete record
      await storage.deleteMailboxItemsByNode(nodeId);
      // Clean up push subscriptions and notification preferences (REQ-007)
      await storage.deletePersonalPushSubscriptionsByNode(nodeId);
      await storage.deleteNotificationPreferences(nodeId);
      // Close WebSocket if connected
      const conn = tunnelManager?.getConnection(nodeId);
      if (conn) {
        try { conn.ws.close(1000, 'deregistered'); } catch { /* ignore */ }
      }
      await storage.deletePersonalNode(nodeId);

      logger.info('Personal node deregistered', { nodeId, ownerName });

      res.json(success(config.nodeId, {
        node_id: nodeId,
        deregistered: true,
        mailbox_purged: true,
      }, [
        {
          description: 'Register a new personal node',
          method: 'POST',
          url: '/v1/personal/anchor',
        },
      ]));
      emitChange('personal');
    } catch (err) {
      logger.error('Failed to deregister personal node', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to deregister personal node'));
    }
  });

  // GET /v1/personal/mailbox/:nodeId — View mailbox stats (owner or operator)
  router.get('/v1/personal/mailbox/:nodeId', requireAuth(), requireRole('owner'), requireScope('tunnel:connect'), async (req, res) => {
    try {
      const nodeId = req.params.nodeId as string;
      const ownerName = req.auth!.owner;

      const node = await storage.getPersonalNode(nodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${nodeId} not found`));
        return;
      }

      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only view mailbox for your own personal nodes'));
        return;
      }

      const stats = await mailboxService.getStats(nodeId);
      const items = await storage.listMailboxItems(nodeId);

      const byType: Record<string, number> = {};
      for (const item of items) {
        byType[item.type] = (byType[item.type] ?? 0) + 1;
      }

      res.json(success(config.nodeId, {
        node_id: nodeId,
        items: stats.count,
        total_bytes: stats.totalBytes,
        quota_bytes: node.mailboxQuotaBytes,
        by_type: byType,
        oldest: items.length > 0 ? items[0].createdAt : null,
        newest: items.length > 0 ? items[items.length - 1].createdAt : null,
      }));
    } catch (err) {
      logger.error('Failed to get mailbox stats', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get mailbox stats'));
    }
  });

  // ── Push Subscription Routes (REQ-007) ─────────────────────

  // POST /v1/personal/push/subscribe — Register a push subscription
  router.post('/v1/personal/push/subscribe', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      if (!config.pushEnabled) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Push notifications are disabled on this node'));
        return;
      }

      const { personalNodeId, endpoint, keys } = req.body ?? {};
      if (!personalNodeId || !endpoint || !keys?.p256dh || !keys?.auth) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'personalNodeId, endpoint, and keys (p256dh, auth) are required'));
        return;
      }

      // Verify node exists
      const node = await storage.getPersonalNode(personalNodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${personalNodeId} not found`));
        return;
      }

      // Verify ownership (or operator)
      const ownerName = req.auth!.owner;
      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only manage push subscriptions for your own personal nodes'));
        return;
      }

      // Validate endpoint against allowed domains (SSRF prevention)
      if (!isAllowedPushEndpoint(endpoint)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Push endpoint domain is not allowed'));
        return;
      }

      // Check subscription count limit
      const count = await storage.countPersonalPushSubscriptions(personalNodeId);
      if (count >= config.pushMaxSubscriptionsPerNode) {
        res.status(429).json(error(config.nodeId, 'QUOTA_EXCEEDED', `Maximum ${config.pushMaxSubscriptionsPerNode} push subscriptions per node`));
        return;
      }

      const now = new Date().toISOString();
      const subscription = await storage.createPersonalPushSubscription({
        id: uuidv4(),
        personalNodeId,
        ownerName,
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        failureCount: 0,
        createdAt: now,
        lastUsedAt: null,
      });

      logger.info('Push subscription created', { subId: subscription.id, nodeId: personalNodeId });

      res.status(201).json(success(config.nodeId, {
        id: subscription.id,
        personal_node_id: subscription.personalNodeId,
        endpoint: subscription.endpoint.substring(0, 60) + '...',
        created_at: subscription.createdAt,
      }, [
        {
          description: 'List push subscriptions',
          method: 'GET',
          url: `/v1/personal/push/subscriptions/${encodeURIComponent(personalNodeId)}`,
        },
        {
          description: 'Test push notification',
          method: 'POST',
          url: `/v1/personal/push/test/${encodeURIComponent(personalNodeId)}`,
        },
      ]));
      emitChange('personal');
    } catch (err) {
      logger.error('Failed to create push subscription', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to create push subscription'));
    }
  });

  // DELETE /v1/personal/push/subscribe/:id — Remove a push subscription
  router.delete('/v1/personal/push/subscribe/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const subId = req.params.id as string;
      const ownerName = req.auth!.owner;

      const subscription = await storage.getPersonalPushSubscription(subId);
      if (!subscription) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Push subscription ${subId} not found`));
        return;
      }

      // Verify ownership (or operator)
      if (subscription.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only delete your own push subscriptions'));
        return;
      }

      await storage.deletePersonalPushSubscription(subId);
      logger.info('Push subscription deleted', { subId, nodeId: subscription.personalNodeId });

      res.json(success(config.nodeId, {
        id: subId,
        deleted: true,
      }));
      emitChange('personal');
    } catch (err) {
      logger.error('Failed to delete push subscription', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to delete push subscription'));
    }
  });

  // GET /v1/personal/push/subscriptions/:nodeId — List push subscriptions for a node
  router.get('/v1/personal/push/subscriptions/:nodeId', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const nodeId = req.params.nodeId as string;
      const ownerName = req.auth!.owner;

      const node = await storage.getPersonalNode(nodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${nodeId} not found`));
        return;
      }

      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only view push subscriptions for your own personal nodes'));
        return;
      }

      const subscriptions = await storage.listPersonalPushSubscriptions(nodeId);
      const truncated = subscriptions.map(sub => ({
        id: sub.id,
        endpoint: sub.endpoint.substring(0, 60) + '...',
        failure_count: sub.failureCount,
        created_at: sub.createdAt,
        last_used_at: sub.lastUsedAt,
      }));

      res.json(success(config.nodeId, {
        node_id: nodeId,
        subscriptions: truncated,
        total: truncated.length,
        max: config.pushMaxSubscriptionsPerNode,
      }));
    } catch (err) {
      logger.error('Failed to list push subscriptions', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list push subscriptions'));
    }
  });

  // POST /v1/personal/push/test/:nodeId — Send a test push notification
  router.post('/v1/personal/push/test/:nodeId', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const nodeId = req.params.nodeId as string;
      const ownerName = req.auth!.owner;

      const node = await storage.getPersonalNode(nodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${nodeId} not found`));
        return;
      }

      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only test push notifications for your own personal nodes'));
        return;
      }

      if (!notificationService) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Push notification service is not available'));
        return;
      }

      // Create a synthetic test mailbox item
      const now = new Date().toISOString();
      const testItem: MailboxItemRecord = {
        id: `test-${uuidv4()}`,
        personalNodeId: nodeId,
        type: 'action_request',
        fromGaii: 'system:test',
        toGaii: node.agentGaiis[0] ?? 'unknown',
        payload: JSON.stringify({ event: 'push.test', message: 'Test notification' }),
        sizeBytes: 0,
        retentionDays: 0,
        expiresAt: now,
        createdAt: now,
      };

      const result = await notificationService.notify(nodeId, testItem);

      res.json(success(config.nodeId, {
        node_id: nodeId,
        test_sent: result.sent,
        channel: result.channel ?? null,
        reason: result.reason ?? null,
      }));
      emitChange('personal');
    } catch (err) {
      logger.error('Failed to send test push notification', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to send test push notification'));
    }
  });

  // ── Notification Preferences Routes (REQ-007) ──────────────

  // GET /v1/personal/anchor/:nodeId/notifications — Get notification preferences
  router.get('/v1/personal/anchor/:nodeId/notifications', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const nodeId = req.params.nodeId as string;
      const ownerName = req.auth!.owner;

      const node = await storage.getPersonalNode(nodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${nodeId} not found`));
        return;
      }

      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only view notification preferences for your own personal nodes'));
        return;
      }

      const stored = await storage.getNotificationPreferences(nodeId);
      const defaults: NotificationPreferences = {
        personalNodeId: nodeId,
        enabled: true,
        channels: ['web_push'],
        notifyTypes: [...config.pushNotifyTypes],
        cooldownMinutes: config.pushCooldownMin,
        quietHoursUtc: null,
        email: null,
      };

      const prefs = stored ?? defaults;

      res.json(success(config.nodeId, {
        personal_node_id: prefs.personalNodeId,
        enabled: prefs.enabled,
        channels: prefs.channels,
        notify_types: prefs.notifyTypes,
        cooldown_minutes: prefs.cooldownMinutes,
        quiet_hours_utc: prefs.quietHoursUtc,
        email: prefs.email,
        is_default: !stored,
      }, [
        {
          description: 'Update notification preferences',
          method: 'PATCH',
          url: `/v1/personal/anchor/${encodeURIComponent(nodeId)}/notifications`,
        },
      ]));
    } catch (err) {
      logger.error('Failed to get notification preferences', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get notification preferences'));
    }
  });

  // PATCH /v1/personal/anchor/:nodeId/notifications — Update notification preferences
  router.patch('/v1/personal/anchor/:nodeId/notifications', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const nodeId = req.params.nodeId as string;
      const ownerName = req.auth!.owner;

      const node = await storage.getPersonalNode(nodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${nodeId} not found`));
        return;
      }

      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only update notification preferences for your own personal nodes'));
        return;
      }

      const body = req.body ?? {};

      // Validate channels
      if (body.channels !== undefined) {
        if (!Array.isArray(body.channels) || !body.channels.every((c: unknown) => c === 'web_push' || c === 'email')) {
          res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'channels must be an array of "web_push" or "email"'));
          return;
        }
      }

      // Validate cooldownMinutes
      if (body.cooldownMinutes !== undefined) {
        if (typeof body.cooldownMinutes !== 'number' || body.cooldownMinutes < 1 || body.cooldownMinutes > 1440) {
          res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'cooldownMinutes must be a number between 1 and 1440'));
          return;
        }
      }

      // Validate quietHoursUtc
      if (body.quietHoursUtc !== undefined && body.quietHoursUtc !== null) {
        const qh = body.quietHoursUtc;
        const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
        if (!qh.start || !qh.end || !hhmmRegex.test(qh.start) || !hhmmRegex.test(qh.end)) {
          res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'quietHoursUtc must have start and end in HH:MM format'));
          return;
        }
      }

      // Validate enabled
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'enabled must be a boolean'));
        return;
      }

      // Validate notifyTypes
      if (body.notifyTypes !== undefined) {
        const validTypes = ['work_assignment', 'action_request', 'board_notification', 'federation_sync'];
        if (!Array.isArray(body.notifyTypes) || !body.notifyTypes.every((t: unknown) => typeof t === 'string' && validTypes.includes(t as string))) {
          res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `notifyTypes must be an array of: ${validTypes.join(', ')}`));
          return;
        }
      }

      // Validate email
      if (body.email !== undefined && body.email !== null) {
        if (typeof body.email !== 'string' || !body.email.includes('@')) {
          res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'email must be a valid email address'));
          return;
        }
      }

      // Merge with existing preferences (or defaults)
      const existing = await storage.getNotificationPreferences(nodeId) ?? {
        personalNodeId: nodeId,
        enabled: true,
        channels: ['web_push'] as ('web_push' | 'email')[],
        notifyTypes: [...config.pushNotifyTypes],
        cooldownMinutes: config.pushCooldownMin,
        quietHoursUtc: null,
        email: null,
      };

      const merged: NotificationPreferences = {
        personalNodeId: nodeId,
        enabled: body.enabled !== undefined ? body.enabled : existing.enabled,
        channels: body.channels !== undefined ? body.channels : existing.channels,
        notifyTypes: body.notifyTypes !== undefined ? body.notifyTypes : existing.notifyTypes,
        cooldownMinutes: body.cooldownMinutes !== undefined ? body.cooldownMinutes : existing.cooldownMinutes,
        quietHoursUtc: body.quietHoursUtc !== undefined ? body.quietHoursUtc : existing.quietHoursUtc,
        email: body.email !== undefined ? body.email : existing.email,
      };

      const saved = await storage.upsertNotificationPreferences(merged);

      res.json(success(config.nodeId, {
        personal_node_id: saved.personalNodeId,
        enabled: saved.enabled,
        channels: saved.channels,
        notify_types: saved.notifyTypes,
        cooldown_minutes: saved.cooldownMinutes,
        quiet_hours_utc: saved.quietHoursUtc,
        email: saved.email,
        is_default: false,
      }, [
        {
          description: 'View notification preferences',
          method: 'GET',
          url: `/v1/personal/anchor/${encodeURIComponent(nodeId)}/notifications`,
        },
      ]));
      emitChange('personal');
    } catch (err) {
      logger.error('Failed to update notification preferences', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to update notification preferences'));
    }
  });

  return router;
}
