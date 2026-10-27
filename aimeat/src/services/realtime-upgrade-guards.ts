/**
 * @file src/services/realtime-upgrade-guards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The limits the realtime WebSocket upgrade applies before a socket joins a room
 *   (index-start.ts), in one place (secaudit2026oct26):
 *   - realtimeMaxPayload: the largest frame the socket library receives. Its default is 100 MiB,
 *     received whole before the room's own size check (realtime.max_message_size_bytes, counted in
 *     characters). The limit is three bytes for each character the check allows, plus a margin, so
 *     every frame the check lets through still arrives; a larger one closes the socket with 1009.
 *   - upgradeClientKey: who an anonymous echat upgrade is counted as. The upgrade runs outside
 *     Express, so it read the socket address, which behind the documented same-host proxy is the
 *     proxy's for every visitor. It now applies the Express app's own trust-proxy rule, as req.ip
 *     does, and folds IPv6 to its /64 as the HTTP limiters do.
 *   - EchatDoor: the room an anonymous echat upgrade joins. Visitors hold at most
 *     realtime.echat_max_rooms rooms together (0 is no separate limit), inside realtime.max_rooms,
 *     so they cannot take every room the node's apps use; and a room made for an upgrade whose
 *     handshake then failed is closed when its socket closes, instead of waiting an hour for the
 *     idle reaper.
 * @structure realtimeMaxPayload(limitChars) · upgradeClientKey(request, trust) · EchatDoor
 * @usage
 *   realtimeWss.options.maxPayload = realtimeMaxPayload(config.realtimeMaxMessageSizeBytes);
 *   const key = upgradeClientKey(request, app.get('trust proxy fn'));
 *   const { room, settle } = await echatDoor.open(roomName);
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26: realtimeWss:no-maxPayload, echat-rate-key-socket-address,
 *     getOrCreateRoomByName:anonymous-room-cap-exhaustion).
 */
import type { IncomingMessage } from 'node:http';
import type { AimeatConfig } from '../config.js';
import { ipRateKey } from '../middleware/rate-limit.js';
import { logger } from '../utils/logger.js';
import type { RealtimeManager, RealtimeRoom } from './realtime-manager.js';
import { ECHAT_ANONYMOUS_CREATOR } from './realtime-yjs.js';

/** UTF-8 takes at most three bytes for one UTF-16 code unit, so this keeps every frame the size check passes. */
export function realtimeMaxPayload(limitChars: number): number {
  return limitChars * 3 + 1024;
}

/** Express's compiled trust-proxy function (app.get('trust proxy fn')): is the address at hop `i` a trusted proxy? */
export type TrustProxyFn = (address: string, hop: number) => boolean;

/**
 * The address an upgrade is counted as: the socket address, then each X-Forwarded-For entry from the
 * nearest, for as long as the one before is a trusted proxy (the walk proxy-addr does for req.ip).
 * With no trusted proxy it is the socket address, as before. IPv6 is folded to its /64 (ipRateKey).
 */
export function upgradeClientKey(request: Pick<IncomingMessage, 'socket' | 'headers'>, trust?: TrustProxyFn | null): string {
  const socketAddress = request.socket.remoteAddress ?? '';
  const header = request.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : header ?? '')
    .split(',').map(s => s.trim()).filter(Boolean).reverse();
  const hops = [socketAddress, ...forwarded];
  let client = socketAddress;
  if (trust) {
    for (let i = 0; i < hops.length; i++) {
      client = hops[i];
      if (i === hops.length - 1 || !trust(hops[i], i)) break;
    }
  }
  return ipRateKey(client || undefined);
}

/** The room an anonymous echat upgrade joins, with the visitors' room limit and the unjoined-room cleanup. */
export class EchatDoor {
  /** Upgrades between the room lookup and the end of their handshake, per room id. */
  private pending = new Map<string, number>();

  constructor(
    private manager: RealtimeManager,
    private config: Pick<AimeatConfig, 'realtimeEchatMaxRooms'>,
  ) { }

  /**
   * The room named `name`, made when there is none. Throws ROOM_LIMIT_REACHED when visitors already
   * hold realtime.echat_max_rooms rooms (and, from createRoom, when the node holds realtime.max_rooms),
   * and INVALID_ROOM_NAME as getOrCreateRoomByName does. `settle` is called once the handshake has
   * ended either way, and again harmlessly: a room nobody joined is then closed.
   */
  async open(name: string): Promise<{ room: RealtimeRoom; settle: () => void }> {
    const echatRooms = this.manager.listAllRooms().filter(r => r.createdBy === ECHAT_ANONYMOUS_CREATOR);
    const cap = this.config.realtimeEchatMaxRooms;
    if (cap > 0 && !echatRooms.some(r => r.name === name) && echatRooms.length >= cap) {
      throw new Error('ROOM_LIMIT_REACHED');
    }
    const room = await this.manager.getOrCreateRoomByName(name, ECHAT_ANONYMOUS_CREATOR);
    this.pending.set(room.id, (this.pending.get(room.id) ?? 0) + 1);
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      const left = (this.pending.get(room.id) ?? 1) - 1;
      if (left > 0) { this.pending.set(room.id, left); return; }
      this.pending.delete(room.id);
      const live = this.manager.getRoom(room.id);
      if (live && live.peers.size === 0) {
        void this.manager.closeRoom(room.id).catch(err => logger.warn('echat: an unjoined room was not closed', { roomId: room.id, error: String(err) }));
      }
    };
    return { room, settle };
  }
}
