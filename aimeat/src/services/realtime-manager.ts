/**
 * @file src/services/realtime-manager.ts
 * @description In-memory WebSocket room manager for realtime apps — rooms, peers, presence/signal
 *   relay, Yjs collaborative-doc sync, echat chat with history cache, per-peer rate limiting,
 *   idle cleanup, metrics, and cross-node federation relays.
 *
 * @structure
 *   - RealtimeMessage / PeerConnection / RealtimeRoom / RealtimeStats: wire + internal types
 *   - RealtimeManager: room lifecycle (create/join/close, auto-delete empty), message routing, broadcast
 *   - Yjs snapshots: store latest update per doc, persist to memory, reload on demand
 *   - Federation relay: fetch/discover remote rooms, bridge a local room to a remote node's room
 *   - Cleanup + metrics: idle-room reaper, message/peer counters, getStats()
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-13 — Wire + internal types extracted to ./realtime-types.ts (max-file-lines)
 */
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import type {
  RealtimeMessage,
  PeerConnection,
  RealtimeRoom,
  CreateRoomOpts,
  RealtimeStats,
} from './realtime-types.js';

// Re-export the wire + internal types so existing importers keep working.
export type {
  RealtimeMessage,
  PeerConnection,
  RealtimeRoom,
  CreateRoomOpts,
  RealtimeStats,
} from './realtime-types.js';

export class RealtimeManager {
  private rooms = new Map<string, RealtimeRoom>();
  private peerToRoom = new Map<string, string>(); // peerId → roomId
  private wsToPerr = new Map<WebSocket, string>(); // ws → peerId
  private roomNameIndex = new Map<string, string>(); // room name → room UUID
  private roomMessageCache = new Map<string, Array<{ sender: string; payload: unknown; ts: number }>>();
  private static readonly ECHAT_MAX_CACHED_MESSAGES = 200;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly RATE_LIMIT_WINDOW_MS = 1000;

  // ── Metrics counters ──
  private metricsMessagesIn = 0;
  private metricsMessagesOut = 0;
  private metricsMessagesRejected = 0;
  private metricsRoomsCreated = 0;
  private metricsRoomsClosed = 0;
  private metricsPeakPeers = 0;

  // ── Federation relay ──
  private federatedRelays = new Map<string, WebSocket>(); // nodeId → WS to remote node

  constructor(
    private config: AimeatConfig,
    private storage: Storage,
  ) { }

  // ── Room lifecycle ──

  async createRoom(opts: CreateRoomOpts): Promise<RealtimeRoom> {
    if (this.rooms.size >= this.config.realtimeMaxRooms) {
      throw new Error('ROOM_LIMIT_REACHED');
    }

    const now = new Date();
    const room: RealtimeRoom = {
      id: randomUUID(),
      appType: opts.appType,
      name: opts.name,
      createdBy: opts.createdBy,
      maxPeers: Math.min(opts.maxPeers ?? this.config.realtimeMaxPeersPerRoom, this.config.realtimeMaxPeersPerRoom),
      isPublic: opts.isPublic ?? true,
      tags: opts.tags ?? [],
      peers: new Map(),
      yjsSnapshots: new Map(),
      peerMsgTimestamps: new Map(),
      createdAt: now,
      lastActivityAt: now,
    };

    this.rooms.set(room.id, room);

    // Persist to storage
    await this.storage.createRealtimeRoom({
      id: room.id,
      appType: room.appType,
      name: room.name,
      createdBy: room.createdBy,
      maxPeers: room.maxPeers,
      isPublic: room.isPublic,
      tags: room.tags,
      peerCount: 0,
      createdAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
    });

    this.metricsRoomsCreated++;
    this.updatePeakPeers();
    logger.info('Realtime room created', { roomId: room.id, appType: room.appType });
    return room;
  }

  async getOrCreateRoomByName(name: string, createdBy: string): Promise<RealtimeRoom> {
    // Validate room name: 1-64 chars, alphanumeric + hyphens
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(name)) {
      throw new Error('INVALID_ROOM_NAME');
    }

    const existingId = this.roomNameIndex.get(name);
    if (existingId) {
      const room = this.rooms.get(existingId);
      if (room) return room;
      // Stale index entry — clean up
      this.roomNameIndex.delete(name);
    }

    const room = await this.createRoom({
      appType: 'echat',
      name,
      createdBy,
      isPublic: false,
      tags: ['echat'],
    });
    this.roomNameIndex.set(name, room.id);
    return room;
  }

  joinRoom(roomId: string, ws: WebSocket, nick: string): PeerConnection | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    if (room.peers.size >= room.maxPeers) {
      this.sendToWs(ws, { type: 'error', code: 'ROOM_FULL', message: 'Room is full' });
      return null;
    }

    const peerId = randomUUID();
    const peer: PeerConnection = {
      peerId,
      ws,
      nick,
      roomId,
      state: {},
      joinedAt: new Date(),
    };

    room.peers.set(peerId, peer);
    room.lastActivityAt = new Date();
    this.peerToRoom.set(peerId, roomId);
    this.wsToPerr.set(ws, peerId);

    // Update storage peer count
    this.storage.updateRealtimeRoom(roomId, {
      peerCount: room.peers.size,
      lastActivityAt: room.lastActivityAt.toISOString(),
    }).catch(() => { });

    // Notify the new peer
    const peerList = [...room.peers.values()]
      .filter(p => p.peerId !== peerId)
      .map(p => ({ peerId: p.peerId, nick: p.nick, state: p.state }));

    this.sendToWs(ws, {
      type: 'joined',
      roomId,
      peerId,
      peers: peerList,
    });

    // Notify existing peers
    this.broadcastToRoom(roomId, peerId, {
      type: 'peer-joined',
      peerId,
      nick,
      state: {},
    });

    // Broadcast echat participant join event
    this.broadcastToRoom(roomId, peerId, {
      type: 'participant',
      room: room.name,
      action: 'join',
      name: nick,
      count: room.peers.size,
    });

    // Send room-meta for echat clients (needed for key derivation salt)
    this.sendToWs(ws, {
      type: 'room-meta',
      room: room.name,
      roomId,
      nodeId: this.config.nodeId,
      createdAt: room.createdAt.getTime(),
      participants: [...room.peers.values()].map(p => p.nick),
    });

    // Send cached message history for echat rooms
    const cache = this.roomMessageCache.get(roomId);
    if (cache && cache.length > 0) {
      this.sendToWs(ws, {
        type: 'history',
        room: room.name,
        messages: cache,
      });
    }

    // Register WS handlers
    ws.on('message', (data) => {
      try {
        const raw = typeof data === 'string' ? data : data.toString('utf-8');
        if (raw.length > this.config.realtimeMaxMessageSizeBytes) {
          this.sendToWs(ws, { type: 'error', code: 'MESSAGE_TOO_LARGE', message: 'Message exceeds size limit' });
          return;
        }
        // Per-peer rate limiting
        if (this.isRateLimited(room, peerId)) {
          this.metricsMessagesRejected++;
          this.sendToWs(ws, { type: 'error', code: 'RATE_LIMITED', message: 'Too many messages, slow down' });
          return;
        }
        this.metricsMessagesIn++;
        const msg: RealtimeMessage = JSON.parse(raw);
        this.handleMessage(peerId, roomId, msg);
      } catch {
        this.sendToWs(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Could not parse message' });
      }
    });

    ws.on('close', () => this.removePeer(peerId));
    ws.on('error', () => this.removePeer(peerId));

    this.updatePeakPeers();
    logger.info('Peer joined room', { roomId, peerId, nick });
    return peer;
  }

  private removePeer(peerId: string): void {
    const roomId = this.peerToRoom.get(peerId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (room) {
      const peer = room.peers.get(peerId);
      if (peer) {
        this.wsToPerr.delete(peer.ws);
      }

      // Broadcast participant leave for echat
      const leavingPeer = room.peers.get(peerId);
      if (leavingPeer) {
        this.broadcastToRoom(roomId, peerId, {
          type: 'participant',
          room: room.name,
          action: 'leave',
          name: leavingPeer.nick,
          count: room.peers.size - 1,
        });
      }

      room.peers.delete(peerId);

      // Notify remaining peers
      for (const p of room.peers.values()) {
        this.sendToWs(p.ws, { type: 'peer-left', peerId });
      }

      // Update storage
      this.storage.updateRealtimeRoom(roomId, {
        peerCount: room.peers.size,
        lastActivityAt: new Date().toISOString(),
      }).catch(() => { });

      // Auto-delete empty rooms
      if (room.peers.size === 0) {
        // Clean up echat caches
        this.roomMessageCache.delete(roomId);
        // Remove name index entry
        for (const [name, id] of this.roomNameIndex) {
          if (id === roomId) { this.roomNameIndex.delete(name); break; }
        }
        this.rooms.delete(roomId);
        this.storage.deleteRealtimeRoom(roomId).catch(() => { });
        logger.info('Realtime room auto-deleted (empty)', { roomId });
      }
    }

    this.peerToRoom.delete(peerId);
  }

  async closeRoom(roomId: string): Promise<boolean> {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    // Disconnect all peers
    for (const peer of room.peers.values()) {
      this.sendToWs(peer.ws, { type: 'error', code: 'ROOM_CLOSED', message: 'Room has been closed' });
      peer.ws.close();
      this.peerToRoom.delete(peer.peerId);
      this.wsToPerr.delete(peer.ws);
    }

    // Clean up echat caches before room deletion
    this.roomMessageCache.delete(roomId);
    for (const [name, id] of this.roomNameIndex) {
      if (id === roomId) { this.roomNameIndex.delete(name); break; }
    }

    this.rooms.delete(roomId);
    this.metricsRoomsClosed++;
    await this.storage.deleteRealtimeRoom(roomId);
    logger.info('Realtime room closed', { roomId });
    return true;
  }

  // ── Message handling ──

  private handleMessage(peerId: string, roomId: string, msg: RealtimeMessage): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.lastActivityAt = new Date();

    switch (msg.type) {
      case 'presence': {
        const peer = room.peers.get(peerId);
        if (peer && msg.state) {
          peer.state = msg.state;
          this.broadcastToRoom(roomId, peerId, {
            type: 'peer-presence',
            peerId,
            state: msg.state,
          });
        }
        break;
      }

      case 'signal': {
        if (!msg.to) return;
        const target = room.peers.get(msg.to);
        if (target) {
          this.sendToWs(target.ws, {
            type: 'signal',
            from: peerId,
            payload: msg.payload,
          });
        }
        break;
      }

      case 'broadcast': {
        this.broadcastToRoom(roomId, peerId, {
          type: 'broadcast',
          from: peerId,
          payload: msg.payload,
        });
        break;
      }

      case 'yjs-sync': {
        if (!msg.docId) return;

        // If peer requests full document state, send stored snapshot
        if (msg.requestState) {
          const snapshot = room.yjsSnapshots.get(msg.docId);
          if (snapshot) {
            const peer = room.peers.get(peerId);
            if (peer) {
              this.sendToWs(peer.ws, {
                type: 'yjs-sync',
                from: '__server__',
                docId: msg.docId,
                update: snapshot,
              });
            }
          }
          return;
        }

        // Store latest update as snapshot for late-joining peers
        if (msg.update) {
          room.yjsSnapshots.set(msg.docId, msg.update);
        }

        // Broadcast update to other peers
        this.broadcastToRoom(roomId, peerId, {
          type: 'yjs-sync',
          from: peerId,
          docId: msg.docId,
          update: msg.update,
        });
        break;
      }

      case 'chat': {
        const peer = room.peers.get(peerId);
        if (!peer) break;
        const chatMsg = {
          sender: peer.nick,
          payload: msg.payload,
          ts: Date.now(),
        };
        // Cache for late-joiners
        let cache = this.roomMessageCache.get(roomId);
        if (!cache) {
          cache = [];
          this.roomMessageCache.set(roomId, cache);
        }
        cache.push(chatMsg);
        if (cache.length > RealtimeManager.ECHAT_MAX_CACHED_MESSAGES) {
          cache.shift(); // FIFO eviction
        }
        // Broadcast to all peers in room (including sender for confirmation)
        for (const p of room.peers.values()) {
          if (p.ws.readyState === 1) {
            p.ws.send(JSON.stringify({
              type: 'chat',
              room: room.name,
              sender: peer.nick,
              payload: msg.payload,
              ts: chatMsg.ts,
            }));
            this.metricsMessagesOut++;
          }
        }
        break;
      }

      case 'set-name': {
        const peer = room.peers.get(peerId);
        if (peer && msg.name) {
          const oldNick = peer.nick;
          peer.nick = msg.name;
          // Notify room of name change
          this.broadcastToRoom(roomId, '', {
            type: 'participant',
            room: room.name,
            action: 'rename',
            name: msg.name,
            peerId,
            message: oldNick,  // old name for client display
            count: room.peers.size,
          });
        }
        break;
      }

      case 'leave': {
        const peer = room.peers.get(peerId);
        if (peer) {
          peer.ws.close();
          this.removePeer(peerId);
        }
        break;
      }

      default:
        // Unknown message type — ignore
        break;
    }
  }

  private broadcastToRoom(roomId: string, excludePeerId: string, msg: RealtimeMessage): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const data = JSON.stringify(msg);
    for (const peer of room.peers.values()) {
      if (peer.peerId !== excludePeerId && peer.ws.readyState === 1) {
        peer.ws.send(data);
        this.metricsMessagesOut++;
      }
    }
  }

  private sendToWs(ws: WebSocket, msg: RealtimeMessage): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }

  // ── Rate limiting ──

  private isRateLimited(room: RealtimeRoom, peerId: string): boolean {
    const now = Date.now();
    const timestamps = room.peerMsgTimestamps.get(peerId) ?? [];
    const cutoff = now - RealtimeManager.RATE_LIMIT_WINDOW_MS;
    const recent = timestamps.filter(t => t > cutoff);
    recent.push(now);
    room.peerMsgTimestamps.set(peerId, recent);
    return recent.length > this.config.realtimeRateLimitPerSecond;
  }

  // ── Discovery ──

  listRooms(filter?: { appType?: string; tag?: string }): RealtimeRoom[] {
    let rooms = [...this.rooms.values()].filter(r => r.isPublic);
    if (filter?.appType) rooms = rooms.filter(r => r.appType === filter.appType);
    if (filter?.tag) rooms = rooms.filter(r => r.tags.includes(filter.tag!));
    return rooms;
  }

  /** List ALL rooms (including private) — for admin/operator use only. */
  listAllRooms(): RealtimeRoom[] {
    return [...this.rooms.values()];
  }

  getRoom(roomId: string): RealtimeRoom | null {
    return this.rooms.get(roomId) ?? null;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  // ── Cleanup ──

  startCleanupJob(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveRooms();
    }, 60_000); // Check every minute

    logger.info('Realtime room cleanup job started');
  }

  cleanupInactiveRooms(): number {
    const now = Date.now();
    const maxIdle = this.config.realtimeRoomIdleTimeoutMs;
    let cleaned = 0;

    for (const [roomId, room] of this.rooms) {
      if (room.peers.size === 0 && now - room.lastActivityAt.getTime() > maxIdle) {
        this.rooms.delete(roomId);
        this.storage.deleteRealtimeRoom(roomId).catch(() => { });
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} idle realtime rooms`);
    }
    return cleaned;
  }

  // ── WS connection handler (called from index.ts upgrade) ──

  handleUpgrade(ws: WebSocket, roomId: string, nick: string): PeerConnection | null {
    return this.joinRoom(roomId, ws, nick);
  }

  // ── Yjs snapshot persistence ──

  private async saveAllYjsSnapshots(): Promise<void> {
    for (const room of this.rooms.values()) {
      for (const [docId, snapshot] of room.yjsSnapshots) {
        const key = `realtime.yjs.${room.id}.${docId}`;
        const now = new Date().toISOString();
        await this.storage.setMemory({
          key,
          ownerGaii: room.createdBy,
          value: snapshot,
          visibility: 'private',
          tags: ['realtime', 'yjs-snapshot'],
          ttlHours: 168, // 7 days
          version: 1,
          createdAt: now,
          updatedAt: now,
        }).catch(err => {
          logger.warn('Failed to persist Yjs snapshot', { roomId: room.id, docId, err });
        });
      }
    }
  }

  async loadYjsSnapshot(roomId: string, docId: string, createdBy: string): Promise<string | null> {
    const key = `realtime.yjs.${roomId}.${docId}`;
    const record = await this.storage.getMemory(createdBy, key);
    return record ? (record.value as string) : null;
  }

  // ── Metrics ──

  private updatePeakPeers(): void {
    let totalPeers = 0;
    for (const room of this.rooms.values()) {
      totalPeers += room.peers.size;
    }
    if (totalPeers > this.metricsPeakPeers) {
      this.metricsPeakPeers = totalPeers;
    }
  }

  getStats(): RealtimeStats {
    let totalPeers = 0;
    for (const room of this.rooms.values()) {
      totalPeers += room.peers.size;
    }
    return {
      rooms: this.rooms.size,
      peers: totalPeers,
      messagesIn: this.metricsMessagesIn,
      messagesOut: this.metricsMessagesOut,
      messagesRejected: this.metricsMessagesRejected,
      roomsCreated: this.metricsRoomsCreated,
      roomsClosed: this.metricsRoomsClosed,
      peakConcurrentPeers: this.metricsPeakPeers,
    };
  }

  // ── Federation relay ──

  /**
   * Fetch public rooms from a remote peer node for cross-node discovery.
   */
  async fetchRemoteRooms(peerUrl: string, filter?: { appType?: string }): Promise<Array<Record<string, unknown>>> {
    const url = new URL('/v1/realtime/rooms', peerUrl);
    if (filter?.appType) url.searchParams.set('app_type', filter.appType);

    try {
      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(5_000) });
      if (!resp.ok) return [];
      const body = await resp.json() as { data?: { rooms?: Array<Record<string, unknown>> } };
      const rooms = body?.data?.rooms;
      if (!Array.isArray(rooms)) return [];
      // Tag each room with origin node
      return rooms.map(r => ({ ...r, origin_node: peerUrl }));
    } catch {
      return [];
    }
  }

  /**
   * Discover rooms across all federated peer nodes.
   */
  async discoverFederatedRooms(
    peers: Map<string, { url: string; status: string }>,
    filter?: { appType?: string },
  ): Promise<Array<Record<string, unknown>>> {
    const activePeers = [...peers.values()].filter(p => p.status === 'active');
    const fetches = activePeers.map(p => this.fetchRemoteRooms(p.url, filter));
    const results = await Promise.allSettled(fetches);

    const remoteRooms: Array<Record<string, unknown>> = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        remoteRooms.push(...r.value);
      }
    }
    return remoteRooms;
  }

  /**
   * Connect a federation relay WebSocket to a remote node's room.
   * Messages from that room are re-broadcast to the local room.
   */
  connectFederationRelay(localRoomId: string, remoteNodeUrl: string, remoteRoomId: string, token: string): boolean {
    const room = this.rooms.get(localRoomId);
    if (!room) return false;

    const relayKey = `${localRoomId}:${remoteRoomId}`;
    if (this.federatedRelays.has(relayKey)) return true; // Already connected

    // Connect to remote WS (dynamic import to avoid bundling issues)
    const wsUrl = remoteNodeUrl.replace(/^http/, 'ws') + `/v1/realtime/ws?room=${remoteRoomId}&token=${encodeURIComponent(token)}&nick=relay:${this.config.nodeId}`;

    import('ws').then(({ default: WsConstructor }) => {
      const remoteWs = new WsConstructor(wsUrl);

      remoteWs.on('open', () => {
        this.federatedRelays.set(relayKey, remoteWs);
        logger.info('Federation relay connected', { localRoomId, remoteRoomId, remoteNodeUrl });
      });

      remoteWs.on('message', (data) => {
        try {
          const raw = typeof data === 'string' ? data : data.toString('utf-8');
          const msg: RealtimeMessage = JSON.parse(raw);
          // Only relay broadcasts and yjs-sync from remote — skip join/leave/presence
          if (msg.type === 'broadcast' || msg.type === 'yjs-sync') {
            msg.from = `relay:${msg.from ?? 'unknown'}`;
            this.broadcastToRoom(localRoomId, '', msg);
          }
        } catch {
          // Skip unparseable messages
        }
      });

      remoteWs.on('close', () => {
        this.federatedRelays.delete(relayKey);
        logger.info('Federation relay disconnected', { localRoomId, remoteRoomId });
      });

      remoteWs.on('error', (err) => {
        logger.warn('Federation relay error', { localRoomId, remoteRoomId, error: (err as Error).message });
        remoteWs.close();
      });
    }).catch(err => {
      logger.warn('Failed to create federation relay', { error: (err as Error).message });
    });

    return true;
  }

  disconnectFederationRelay(localRoomId: string, remoteRoomId: string): void {
    const relayKey = `${localRoomId}:${remoteRoomId}`;
    const ws = this.federatedRelays.get(relayKey);
    if (ws) {
      ws.close();
      this.federatedRelays.delete(relayKey);
    }
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Persist Yjs snapshots before shutdown
    await this.saveAllYjsSnapshots();

    // Close federation relays
    for (const ws of this.federatedRelays.values()) {
      ws.close();
    }
    this.federatedRelays.clear();

    for (const room of this.rooms.values()) {
      for (const peer of room.peers.values()) {
        peer.ws.close();
      }
    }

    this.rooms.clear();
    this.peerToRoom.clear();
    this.wsToPerr.clear();

    logger.info('RealtimeManager shut down');
  }
}
