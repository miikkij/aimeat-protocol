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
 *   v1.2.0 — 2026-06-16 — Add the `publicActivity` broadcast channel carrying a
 *     full public-feed event payload to every public SSE client (landing feed).
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

// ── Public activity channel (broadcast, full payload) ───────────────────────
// The landing page's public activity feed needs the FULL event (category, time,
// summary, link) pushed to every connected public SSE client — unlike the coarse
// `change` channel (a marker the UI uses only to trigger a re-fetch). This is a
// broadcast (no `target`, unlike `delivery`): every public viewer sees the same
// public events. Producers call `recordPublicActivity` (services/public-activity.ts)
// which persists the event, then emits here.

export interface PublicActivityEvent {
  /** Which landing tab this belongs to. */
  category: 'apps' | 'organisms' | 'agents';
  /** ISO 8601 timestamp of when it happened. */
  at: string;
  /** Display name segment only — never a full private GAII path. */
  actor: string;
  /** One-line human summary shown in the feed row. */
  summary: string;
  /** Short curated detail blob (already-public fields only). */
  detail: string;
  /** Link to an existing unauthenticated route for the material/event. */
  link: string;
}

export function emitPublicActivity(evt: PublicActivityEvent): void {
  bus.emit('publicActivity', evt);
}

export function onPublicActivityEvent(handler: (evt: PublicActivityEvent) => void): void {
  bus.on('publicActivity', handler);
}

export function offPublicActivityEvent(handler: (evt: PublicActivityEvent) => void): void {
  bus.off('publicActivity', handler);
}
