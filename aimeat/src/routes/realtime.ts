/**
 * @file src/routes/realtime.ts
 * @description Realtime "rooms" API (gated by config.realtimeEnabled). Lets authenticated
 *   principals create and list rooms for realtime/multiplayer apps, returning a WebSocket URL;
 *   delegates room lifecycle to the RealtimeManager and honours room limits.
 *
 * @structure
 *   - realtimeRouter(config, storage, realtimeManager, peers?): builds the router
 *   - POST /v1/realtime/rooms: create a room (503 when disabled, 429 on ROOM_LIMIT_REACHED)
 *   - additional room listing/lookup routes over realtimeManager
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import type { RealtimeManager } from '../services/realtime-manager.js';
import type { PeerInfo } from '../services/federation.js';

export function realtimeRouter(config: AimeatConfig, storage: Storage, realtimeManager: RealtimeManager, peers?: Map<string, PeerInfo>): Router {
  const router = Router();

  // POST /v1/realtime/rooms — create a new room
  router.post('/v1/realtime/rooms', requireAuth(), async (req, res) => {
    if (!config.realtimeEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Realtime is disabled on this node'));
      return;
    }

    const { app_type, name, max_peers, is_public, tags } = req.body ?? {};
    if (!app_type || typeof app_type !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'app_type is required'));
      return;
    }
    if (!name || typeof name !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'name is required'));
      return;
    }

    try {
      const room = await realtimeManager.createRoom({
        appType: app_type,
        name,
        createdBy: req.auth!.sub,
        maxPeers: max_peers,
        isPublic: is_public,
        tags,
      });

      res.status(201).json(success(config.nodeId, {
        id: room.id,
        app_type: room.appType,
        name: room.name,
        created_by: room.createdBy,
        max_peers: room.maxPeers,
        is_public: room.isPublic,
        tags: room.tags,
        peer_count: room.peers.size,
        created_at: room.createdAt.toISOString(),
        ws_url: `/v1/realtime/ws?room=${room.id}`,
      }, [
        { description: 'Connect via WebSocket', method: 'GET', url: `/v1/realtime/ws?room=${room.id}` },
        { description: 'List rooms', method: 'GET', url: '/v1/realtime/rooms' },
      ]));
      emitChange('realtime');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'ROOM_LIMIT_REACHED') {
        res.status(429).json(error(config.nodeId, 'QUOTA_EXCEEDED', 'Maximum number of rooms reached'));
        return;
      }
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to create room'));
    }
  });

  // GET /v1/realtime/rooms — list public rooms
  router.get('/v1/realtime/rooms', async (req, res) => {
    if (!config.realtimeEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Realtime is disabled on this node'));
      return;
    }

    const appType = req.query.app_type as string | undefined;
    const tag = req.query.tag as string | undefined;

    const rooms = realtimeManager.listRooms({ appType, tag });
    const data = rooms.map(r => ({
      id: r.id,
      app_type: r.appType,
      name: r.name,
      created_by: r.createdBy,
      max_peers: r.maxPeers,
      is_public: r.isPublic,
      tags: r.tags,
      peer_count: r.peers.size,
      created_at: r.createdAt.toISOString(),
      ws_url: `/v1/realtime/ws?room=${r.id}`,
    }));

    res.json(success(config.nodeId, { rooms: data, total: data.length }, [
      { description: 'Create a room', method: 'POST', url: '/v1/realtime/rooms' },
    ]));
  });

  // GET /v1/realtime/rooms/:roomId — get room details
  router.get('/v1/realtime/rooms/:roomId', async (req, res) => {
    if (!config.realtimeEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Realtime is disabled on this node'));
      return;
    }

    const roomId = req.params.roomId as string;
    const room = realtimeManager.getRoom(roomId);
    if (!room) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Room not found'));
      return;
    }

    const peers = [...room.peers.values()].map(p => ({
      peer_id: p.peerId,
      nick: p.nick,
      state: p.state,
      joined_at: p.joinedAt.toISOString(),
    }));

    res.json(success(config.nodeId, {
      id: room.id,
      app_type: room.appType,
      name: room.name,
      created_by: room.createdBy,
      max_peers: room.maxPeers,
      is_public: room.isPublic,
      tags: room.tags,
      peer_count: room.peers.size,
      peers,
      created_at: room.createdAt.toISOString(),
      ws_url: `/v1/realtime/ws?room=${room.id}`,
    }, [
      { description: 'Connect via WebSocket', method: 'GET', url: `/v1/realtime/ws?room=${room.id}` },
      { description: 'Close room', method: 'DELETE', url: `/v1/realtime/rooms/${room.id}` },
    ]));
  });

  // DELETE /v1/realtime/rooms/:roomId — close a room (creator or operator only)
  router.delete('/v1/realtime/rooms/:roomId', requireAuth(), async (req, res) => {
    if (!config.realtimeEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Realtime is disabled on this node'));
      return;
    }

    const roomId = req.params.roomId as string;
    const room = realtimeManager.getRoom(roomId);
    if (!room) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Room not found'));
      return;
    }

    // Only room creator or operator can close
    const isCreator = room.createdBy === req.auth!.sub;
    const isOperator = req.auth!.roles?.includes('operator');
    if (!isCreator && !isOperator) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the room creator or an operator can close this room'));
      return;
    }

    await realtimeManager.closeRoom(roomId);
    res.json(success(config.nodeId, { deleted: true }, [
      { description: 'List rooms', method: 'GET', url: '/v1/realtime/rooms' },
    ]));
    emitChange('realtime');
  });

  // GET /v1/realtime/ice-servers — return ICE server configuration for WebRTC
  router.get('/v1/realtime/ice-servers', requireAuth(), (_req, res) => {
    if (!config.realtimeEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Realtime is disabled on this node'));
      return;
    }

    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];

    // STUN servers
    if (config.stunServers.length > 0) {
      iceServers.push({ urls: config.stunServers });
    }

    // TURN server
    if (config.turnServer) {
      iceServers.push({
        urls: config.turnServer,
        username: config.turnUsername ?? undefined,
        credential: config.turnCredential ?? undefined,
      });
    }

    // Fallback to Google public STUN if nothing configured
    if (iceServers.length === 0) {
      iceServers.push({ urls: 'stun:stun.l.google.com:19302' });
    }

    res.json(success(config.nodeId, { ice_servers: iceServers }, [
      { description: 'List rooms', method: 'GET', url: '/v1/realtime/rooms' },
    ]));
  });

  // GET /v1/realtime/stats — realtime subsystem metrics (operator only)
  router.get('/v1/realtime/stats', requireAuth(), requireRole('operator'), (_req, res) => {
    if (!config.realtimeEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Realtime is disabled on this node'));
      return;
    }

    res.json(success(config.nodeId, realtimeManager.getStats()));
  });

  // GET /v1/realtime/federated-rooms — discover rooms across federated peers
  router.get('/v1/realtime/federated-rooms', async (req, res) => {
    if (!config.realtimeEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Realtime is disabled on this node'));
      return;
    }
    if (!peers || peers.size === 0) {
      res.json(success(config.nodeId, { rooms: [], total: 0, note: 'No federated peers configured' }));
      return;
    }

    const appType = req.query.app_type as string | undefined;

    // Fetch local rooms
    const localRooms = realtimeManager.listRooms({ appType }).map(r => ({
      id: r.id,
      app_type: r.appType,
      name: r.name,
      created_by: r.createdBy,
      peer_count: r.peers.size,
      max_peers: r.maxPeers,
      tags: r.tags,
      origin_node: config.baseUrl,
      ws_url: `/v1/realtime/ws?room=${r.id}`,
    }));

    // Fetch remote rooms from peers
    const remoteRooms = await realtimeManager.discoverFederatedRooms(peers, { appType });

    const allRooms = [...localRooms, ...remoteRooms];
    res.json(success(config.nodeId, {
      rooms: allRooms,
      total: allRooms.length,
      local_count: localRooms.length,
      remote_count: remoteRooms.length,
    }, [
      { description: 'List local rooms', method: 'GET', url: '/v1/realtime/rooms' },
      { description: 'Create a room', method: 'POST', url: '/v1/realtime/rooms' },
    ]));
  });

  // POST /v1/realtime/relay — connect a federation relay between local and remote rooms (operator only)
  router.post('/v1/realtime/relay', requireAuth(), requireRole('operator'), (req, res) => {
    if (!config.realtimeEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Realtime is disabled on this node'));
      return;
    }

    const { local_room_id, remote_node_url, remote_room_id, token } = req.body ?? {};
    if (!local_room_id || !remote_node_url || !remote_room_id || !token) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'local_room_id, remote_node_url, remote_room_id, and token are required'));
      return;
    }

    const connected = realtimeManager.connectFederationRelay(
      local_room_id as string,
      remote_node_url as string,
      remote_room_id as string,
      token as string,
    );

    if (!connected) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Local room not found'));
      return;
    }

    res.json(success(config.nodeId, {
      status: 'connecting',
      local_room_id,
      remote_node_url,
      remote_room_id,
    }));
    emitChange('realtime');
  });

  // DELETE /v1/realtime/relay — disconnect a federation relay (operator only)
  router.delete('/v1/realtime/relay', requireAuth(), requireRole('operator'), (req, res) => {
    if (!config.realtimeEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Realtime is disabled on this node'));
      return;
    }

    const { local_room_id, remote_room_id } = req.body ?? {};
    if (!local_room_id || !remote_room_id) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'local_room_id and remote_room_id are required'));
      return;
    }

    realtimeManager.disconnectFederationRelay(local_room_id as string, remote_room_id as string);

    res.json(success(config.nodeId, {
      status: 'disconnected',
      local_room_id,
      remote_room_id,
    }));
    emitChange('realtime');
  });

  // GET /v1/admin/realtime — full realtime overview for admin dashboard (operator only)
  router.get('/v1/admin/realtime', requireAuth(), requireRole('operator'), (_req, res) => {
    if (!config.realtimeEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Realtime is disabled on this node'));
      return;
    }

    const stats = realtimeManager.getStats();
    const allRooms = realtimeManager.listAllRooms();
    const rooms = allRooms.map(r => ({
      id: r.id,
      app_type: r.appType,
      name: r.name,
      created_by: r.createdBy,
      max_peers: r.maxPeers,
      is_public: r.isPublic,
      tags: r.tags,
      peer_count: r.peers.size,
      peers: [...r.peers.values()].map(p => ({
        peer_id: p.peerId,
        nick: p.nick,
        joined_at: p.joinedAt.toISOString(),
      })),
      yjs_docs: [...r.yjsSnapshots.keys()].map(docId => ({
        doc_id: docId,
        snapshot_size: r.yjsSnapshots.get(docId)?.length ?? 0,
      })),
      created_at: r.createdAt.toISOString(),
      last_activity_at: r.lastActivityAt.toISOString(),
    }));

    res.json(success(config.nodeId, { stats, rooms, total: rooms.length }));
  });

  return router;
}
