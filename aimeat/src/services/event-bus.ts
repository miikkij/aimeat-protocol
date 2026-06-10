/**
 * @file event-bus.ts
 * @description Process-local pub/sub bus for live updates. Two channels:
 *   `change` — coarse domain-string events broadcast to every SSE client (UI
 *   live refresh); `delivery` — agent-scoped targeted events carrying a full
 *   payload, consumed by the ConnectTunnelManager to push a single agent's
 *   socket (realtime reverse delivery). SSE never subscribes to `delivery`, so
 *   per-agent payloads are not broadcast to UI clients.
 * @structure emitChange/onChangeEvent/offChangeEvent (change) +
 *   emitDelivery/onDeliveryEvent/offDeliveryEvent (delivery).
 * @usage import { emitDelivery } from '../services/event-bus.js';
 * @version-history
 *   v1.0.0 — pre-2026-06 — Initial change-event bus for SSE live updates.
 *   v1.1.0 — 2026-06-10 — Add the agent-scoped `delivery` channel for the
 *     connector forward tunnel's realtime reverse delivery.
 */
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0); // unlimited — each SSE client adds a listener

export interface ChangeEvent {
  domain: string;
  timestamp: number;
}

export function emitChange(domain: string): void {
  bus.emit('change', { domain, timestamp: Date.now() } satisfies ChangeEvent);
}

export function onChangeEvent(handler: (evt: ChangeEvent) => void): void {
  bus.on('change', handler);
}

export function offChangeEvent(handler: (evt: ChangeEvent) => void): void {
  bus.off('change', handler);
}

// ── Targeted delivery channel (agent-scoped realtime push) ──────────────────
// The `change` channel above is coarse (a domain string broadcast to every SSE
// client) — unsuitable for pushing a full task payload to ONE agent. This
// separate `delivery` channel carries an explicit `target` identity + the full
// object so the ConnectTunnelManager can fan it out to exactly that agent's
// socket, without leaking the payload to SSE consumers (which never subscribe
// here). This is how Phase 2 "enriches" push with a target identity.

export interface DeliveryEvent {
  /** The GAII this delivery is for. */
  target: string;
  /** Delivery kind, e.g. 'task_assigned' | 'message'. */
  kind: string;
  /** Stable dedup id (e.g. the task id). */
  id: string;
  /** The full object delivered (zero round-trip). */
  payload: unknown;
  timestamp: number;
}

export function emitDelivery(evt: Omit<DeliveryEvent, 'timestamp'>): void {
  bus.emit('delivery', { ...evt, timestamp: Date.now() } satisfies DeliveryEvent);
}

export function onDeliveryEvent(handler: (evt: DeliveryEvent) => void): void {
  bus.on('delivery', handler);
}

export function offDeliveryEvent(handler: (evt: DeliveryEvent) => void): void {
  bus.off('delivery', handler);
}
