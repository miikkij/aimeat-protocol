/**
 * @file src/services/realtime-types.ts
 * @description Wire + internal type definitions for the realtime WebSocket room manager —
 *   the message envelope, per-peer connection, room, room-create options, and stats shapes.
 *   Consumed by ./realtime-manager.ts (which re-exports them) and its callers.
 * @structure RealtimeMessage · PeerConnection · RealtimeRoom · CreateRoomOpts · RealtimeStats
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/services/realtime-manager.ts (max-file-lines)
 */
import type { WebSocket } from 'ws';

// ── Message types ──

export interface RealtimeMessage {
  type: 'join' | 'leave' | 'presence' | 'signal' | 'broadcast' | 'yjs-sync'
    | 'joined' | 'peer-joined' | 'peer-left' | 'peer-presence' | 'error'
    | 'chat' | 'history' | 'participant' | 'set-name' | 'room-meta';
  roomId?: string;
  peerId?: string;
  nick?: string;
  to?: string;
  from?: string;
  state?: Record<string, unknown>;
  payload?: unknown;
  docId?: string;
  update?: string;  // base64 Yjs update
  requestState?: boolean; // Yjs: peer requesting full document state
  peers?: Array<{ peerId: string; nick: string; state: Record<string, unknown> }>;
  code?: string;
  message?: string;
  // echat additions
  room?: string;       // room name (echat)
  sender?: string;     // display name or GAII (echat)
  ts?: number;         // timestamp ms (echat)
  name?: string;       // display name for set-name (echat)
  action?: string;     // 'join' | 'leave' for participant events (echat)
  count?: number;      // participant count (echat)
  messages?: Array<{ sender: string; payload: unknown; ts: number }>;  // history burst
  nodeId?: string;     // node ID for room-meta
  createdAt?: number;  // room creation timestamp for room-meta
  participants?: string[]; // current participant names for room-meta
}

// ── Internal types ──

export interface PeerConnection {
  peerId: string;
  ws: WebSocket;
  nick: string;
  roomId: string;
  state: Record<string, unknown>;
  joinedAt: Date;
}

export interface RealtimeRoom {
  id: string;
  appType: string;
  name: string;
  createdBy: string;
  maxPeers: number;
  isPublic: boolean;
  tags: string[];
  peers: Map<string, PeerConnection>;
  yjsSnapshots: Map<string, string>; // docId → base64 snapshot
  peerMsgTimestamps: Map<string, number[]>; // peerId → recent msg timestamps
  createdAt: Date;
  lastActivityAt: Date;
}

export interface CreateRoomOpts {
  appType: string;
  name: string;
  createdBy: string;
  maxPeers?: number;
  isPublic?: boolean;
  tags?: string[];
}

export interface RealtimeStats {
  rooms: number;
  peers: number;
  messagesIn: number;
  messagesOut: number;
  messagesRejected: number;
  roomsCreated: number;
  roomsClosed: number;
  peakConcurrentPeers: number;
}
