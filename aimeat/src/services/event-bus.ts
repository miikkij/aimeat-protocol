/**
 * @file event-bus.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.3.0 — 2026-06-21 — `change` events carry an optional `ownerGaii` so the SSE
 *     transport can scope owner-private domains per connected owner (hot agent paths);
 *     omitted owner = global broadcast (shared data stays visible to all owners).
 *   v1.4.0 — 2026-06-22 — `MemoryWriteEvent` carries an optional `op` ('created'|'updated') so the
 *     connector record-push (ConnectTunnelManager) can label workspace.record wakes; best-effort,
 *     set by the generic memory route, defaulted to 'updated' by consumers when absent.
 */
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0); // unlimited — each SSE client adds a listener

export interface ChangeEvent {
  domain: string;
  timestamp: number;
  /**
   * Owner this change concerns (GHII or GAII — only the owner SEGMENT is compared). When set,
   * the SSE transport forwards the event ONLY to streams owned by that owner; when ABSENT the
   * event is global (broadcast to every client). Default-omit keeps shared-data changes
   * (organisms, boards, public activity, …) visible to other owners. See sse.ts owner filter.
   */
  ownerGaii?: string;
}

export function emitChange(domain: string, ownerGaii?: string): void {
  bus.emit('change', { domain, timestamp: Date.now(), ...(ownerGaii ? { ownerGaii } : {}) } satisfies ChangeEvent);
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

// ── Memory-write channel (reactive Memory Contracts) ────────────────────────
// The Memory Contract pattern (docs/coding-guidelines/memory-contracts.md) reacts to changes in a
// specific memory key. Central write paths (the generic memory-write route, the workspace publish
// path) emit `memoryWritten` with the written key; the contract subscriber checks the track-registry
// (O(1)) and evaluates only contracts watching that key. This is the event-driven trigger; a
// reconciler sweep is the safety net. Generic on purpose — the bus knows nothing about contracts.

export interface MemoryWriteEvent {
  /** The owner GAII the memory record was written under. */
  ownerGaii: string;
  /** The full memory key that was written. */
  key: string;
  /**
   * Whether this write CREATED the key or UPDATED an existing one. Best-effort: set by the generic
   * memory route (which already knows from its existing-record lookup); omitted by the publish paths
   * (a publish updates the published `.latest` view) — consumers default to 'updated' when absent.
   */
  op?: 'created' | 'updated';
  timestamp: number;
}

export function emitMemoryWritten(ownerGaii: string, key: string, op?: 'created' | 'updated'): void {
  bus.emit('memoryWritten', { ownerGaii, key, ...(op ? { op } : {}), timestamp: Date.now() } satisfies MemoryWriteEvent);
}

export function onMemoryWrittenEvent(handler: (evt: MemoryWriteEvent) => void): void {
  bus.on('memoryWritten', handler);
}

export function offMemoryWrittenEvent(handler: (evt: MemoryWriteEvent) => void): void {
  bus.off('memoryWritten', handler);
}
