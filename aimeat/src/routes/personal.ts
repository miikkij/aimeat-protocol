import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { TunnelManager } from '../services/personal-tunnel.js';
import { MailboxService } from '../services/mailbox.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { AnchorRequestSchema, VisibilityUpdateSchema, validateBody } from '../models/schemas.js';
import { logger } from '../utils/logger.js';

export function personalRouter(config: AimeatConfig, storage: Storage, tunnelManager: TunnelManager | null): Router {
  const router = Router();
  const mailboxService = new MailboxService(config, storage);

  // POST /v1/personal/anchor — Register a personal node with this operator
  router.post('/v1/personal/anchor', requireAuth(), requireRole('owner'), validateBody(AnchorRequestSchema, config.nodeId), async (req, res) => {
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
    } catch (err) {
      logger.error('Failed to anchor personal node', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to register personal node'));
    }
  });

  // GET /v1/personal/status — Check personal node status (by owner)
  router.get('/v1/personal/status', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const ownerName = req.auth!.owner;
      const node = await storage.getPersonalNodeByOwner(ownerName);
      if (!node) {
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
  router.patch('/v1/personal/anchor/:nodeId', requireAuth(), requireRole('owner'), validateBody(VisibilityUpdateSchema, config.nodeId), async (req, res) => {
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
    } catch (err) {
      logger.error('Failed to update personal node', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to update personal node'));
    }
  });

  // DELETE /v1/personal/anchor/:nodeId — Deregister personal node
  router.delete('/v1/personal/anchor/:nodeId', requireAuth(), requireRole('owner'), async (req, res) => {
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
    } catch (err) {
      logger.error('Failed to deregister personal node', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to deregister personal node'));
    }
  });

  // GET /v1/personal/mailbox/:nodeId — View mailbox stats (owner or operator)
  router.get('/v1/personal/mailbox/:nodeId', requireAuth(), requireRole('owner'), async (req, res) => {
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

  return router;
}
