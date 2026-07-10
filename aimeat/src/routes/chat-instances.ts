import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { buildChatInstanceId } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';

export function chatInstancesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/chat-instances — Register a new chat session
  router.post('/v1/chat-instances', requireAuth(), async (req, res) => {
    const { platform, app_name } = req.body ?? {};
    const ownerName = req.auth!.owner;

    if (!platform || typeof platform !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'platform is required'));
      return;
    }

    const appName = (typeof app_name === 'string' && app_name) || `session-${Date.now()}`;
    const id = buildChatInstanceId(platform, appName, ownerName, config.nodeId);
    const ghii = `${ownerName}@${config.nodeId}`;

    // Verify GHII exists
    const ghiiRecord = await storage.getGHII(ghii);
    if (!ghiiRecord) {
      res.status(404).json(error(config.nodeId, 'GHII_NOT_FOUND', `No GHII profile found for "${ownerName}"`));
      return;
    }

    const now = new Date().toISOString();
    const record = await storage.createChatInstance({
      id,
      platform,
      appName,
      ownerName,
      ghii,
      nodeId: config.nodeId,
      isAnonymous: ownerName === 'anonymous',
      createdAt: now,
      lastSeen: now,
    });

    res.status(201).json(success(config.nodeId, {
      chat_instance: {
        id: record.id,
        platform: record.platform,
        app_name: record.appName,
        ghii: record.ghii,
        is_anonymous: record.isAnonymous,
        created_at: record.createdAt,
      },
    }, [
      { description: 'Store data in memory', method: 'POST', url: '/v1/memory' },
      { description: 'List chat instances', method: 'GET', url: '/v1/chat-instances' },
    ]));
    emitChange('chat');
  });

  // GET /v1/chat-instances — List chat instances
  router.get('/v1/chat-instances', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner;
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;

    const instances = await storage.listChatInstances({ ownerName, platform });

    res.json(success(config.nodeId, {
      chat_instances: instances.map(r => ({
        id: r.id,
        platform: r.platform,
        app_name: r.appName,
        ghii: r.ghii,
        is_anonymous: r.isAnonymous,
        created_at: r.createdAt,
        last_seen: r.lastSeen,
        agent_gaii: r.agentGaii || null,
        mcp_client_id: r.mcpClientId || null,
      })),
      total: instances.length,
    }));
  });

  // GET /v1/chat-instances/:id — Get chat instance details
  router.get('/v1/chat-instances/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const record = await storage.getChatInstance(id);

    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Chat instance not found'));
      return;
    }

    // Ownership (SECURITY): a chat instance's economy (morsel balance, trust score) is private to its
    // owner. Only the same owner or an operator may read it — 404 (not 403) so existence isn't confirmed.
    if (record.ghii.split('@')[0] !== req.auth!.owner && !req.auth!.roles.includes('operator')) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Chat instance not found'));
      return;
    }

    // Resolve GHII for economy data
    const ghiiRecord = await storage.getGHII(record.ghii);

    res.json(success(config.nodeId, {
      chat_instance: {
        id: record.id,
        platform: record.platform,
        app_name: record.appName,
        ghii: record.ghii,
        is_anonymous: record.isAnonymous,
        created_at: record.createdAt,
        last_seen: record.lastSeen,
      },
      economy: ghiiRecord ? {
        trust_score: ghiiRecord.trustScore ?? 50,
        morsel_balance: ghiiRecord.morselBalance ?? 0,
        source: 'ghii',
      } : null,
    }));
  });

  // PUT /v1/chat-instances/:id — Update (e.g. lastSeen heartbeat)
  router.put('/v1/chat-instances/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const record = await storage.getChatInstance(id);

    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Chat instance not found'));
      return;
    }

    // Ownership (SECURITY): only the same owner or an operator may update this instance.
    if (record.ghii.split('@')[0] !== req.auth!.owner && !req.auth!.roles.includes('operator')) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Chat instance not found'));
      return;
    }

    const updated = await storage.updateChatInstance(id, {
      lastSeen: new Date().toISOString(),
    });

    res.json(success(config.nodeId, {
      chat_instance: {
        id: updated!.id,
        last_seen: updated!.lastSeen,
      },
    }));
    emitChange('chat');
  });

  // DELETE /v1/chat-instances/:id — End chat session
  router.delete('/v1/chat-instances/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const record = await storage.getChatInstance(id);

    // Ownership (SECURITY): fetch first and verify the caller owns it — only the same owner or an
    // operator may delete this instance (previously deleted by id with no ownership check).
    if (!record || (record.ghii.split('@')[0] !== req.auth!.owner && !req.auth!.roles.includes('operator'))) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Chat instance not found'));
      return;
    }

    await storage.deleteChatInstance(id);
    res.json(success(config.nodeId, { deleted: true, id }));
    emitChange('chat');
  });

  return router;
}
