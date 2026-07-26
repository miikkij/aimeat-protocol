/**
 * @file ecosystem-events.ts
 * @description The ecosystem-app (GEAI) event plane: the per-GEAI OUTBOUND subscription registry and
 *   the best-effort outbound emitter, plus the INBOUND audit log. Outbound events (e.g. memory.write,
 *   binding.revoked) are pushed to a subscribed GEAI over the connect-tunnel via emitDelivery — the
 *   GEAI is just another tunnel identity, so if it is offline the push is dropped (best-effort; the
 *   signed-webhook fallback + at-least-once durable queue are deferred to a later chunk). The grant is
 *   re-checked LIVE at emit time (a revoked GEAI stops receiving immediately). The subscription
 *   registry mirrors the workflow event-index storage pattern (system-namespace memory).
 * @structure
 *   - EcosystemSubscription + read/write/add/remove (system@{nodeId} memory key `ecosystem.subscriptions`)
 *   - emitOutboundEcosystemEvent / emitEcosystemMemoryWrite / emitEcosystemBindingRevoked
 *   - appendInboundEcosystemLog (per-GEAI capped audit log)
 * @usage import { emitEcosystemMemoryWrite } from '../services/ecosystem-events.js';
 * @version-history
 *   v1.0.0 — 2026-06-14 — Created for ecosystem events & triggers (chunk 2).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { emitDelivery } from './event-bus.js';
import { buildEcosystemEnvelope } from '../models/ecosystem-event-schemas.js';
import { globToRegExp } from './workflow/signal-eval.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

const SUBSCRIPTIONS_KEY = 'ecosystem.subscriptions';
const INBOUND_LOG_KEY = 'ecosystem.inbound.log';
const INBOUND_LOG_KEEP = 50;
const systemGhiiFor = (nodeId: string): string => `system@${nodeId}`;

export interface EcosystemSubscription {
  geai: string;                         // eco:{app}#{owner}@{node}
  ownerGhii: string;                    // the owner who granted it (scoping + audit)
  event: string;                        // outbound event name, or '*' for every granted event
  match?: Record<string, string>;       // optional glob filter, e.g. { key: 'crm.*' } on memory.write
  transport: ('tunnel' | 'webhook')[];  // delivery preference (only 'tunnel' acted on this chunk)
  createdAt: string;
}

// ── subscription registry (system-namespace memory; mirrors the workflow event-index) ──
export async function readEcosystemSubscriptions(storage: Storage, nodeId: string): Promise<EcosystemSubscription[]> {
  const rec = await storage.getMemory(systemGhiiFor(nodeId), SUBSCRIPTIONS_KEY);
  const arr = rec?.value as EcosystemSubscription[] | undefined;
  return Array.isArray(arr) ? arr : [];
}

async function writeEcosystemSubscriptions(storage: Storage, nodeId: string, entries: EcosystemSubscription[]): Promise<void> {
  const systemGhii = systemGhiiFor(nodeId);
  const existing = await storage.getMemory(systemGhii, SUBSCRIPTIONS_KEY);
  const now = new Date().toISOString();
  await storage.setMemory({
    key: SUBSCRIPTIONS_KEY, ownerGaii: systemGhii, value: entries,
    visibility: 'private', tags: ['ecosystem-index'], ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/** List an owner's subscriptions (optionally for one GEAI). */
export async function listSubscriptions(storage: Storage, nodeId: string, ownerGhii: string, geai?: string): Promise<EcosystemSubscription[]> {
  const all = await readEcosystemSubscriptions(storage, nodeId);
  return all.filter(s => s.ownerGhii === ownerGhii && (!geai || s.geai === geai));
}

/** Add a subscription (idempotent on {geai,event,match}). Returns the stored entry. */
export async function addSubscription(storage: Storage, nodeId: string, sub: Omit<EcosystemSubscription, 'createdAt'>): Promise<EcosystemSubscription> {
  const all = await readEcosystemSubscriptions(storage, nodeId);
  const key = (s: { geai: string; event: string; match?: Record<string, string> }) => `${s.geai}|${s.event}|${JSON.stringify(s.match ?? {})}`;
  const next = all.filter(s => key(s) !== key(sub));
  const entry: EcosystemSubscription = { ...sub, createdAt: new Date().toISOString() };
  next.push(entry);
  await writeEcosystemSubscriptions(storage, nodeId, next);
  return entry;
}

/** Remove subscriptions for a GEAI (optionally only one event). Returns the count removed. */
export async function removeSubscriptions(storage: Storage, nodeId: string, ownerGhii: string, geai: string, event?: string): Promise<number> {
  const all = await readEcosystemSubscriptions(storage, nodeId);
  const next = all.filter(s => !(s.ownerGhii === ownerGhii && s.geai === geai && (!event || s.event === event)));
  if (next.length !== all.length) await writeEcosystemSubscriptions(storage, nodeId, next);
  return all.length - next.length;
}

// ── outbound emit (best-effort tunnel) ──
function matchPasses(match: Record<string, string> | undefined, payload: Record<string, unknown>): boolean {
  if (!match) return true;
  for (const [field, pat] of Object.entries(match)) {
    const val = payload[field];
    if (val === undefined || val === null) return false;
    if (!globToRegExp(pat).test(String(val))) return false;
  }
  return true;
}

/**
 * Fan one outbound event to every subscribed, still-granted GEAI of `ownerGhii`. Best-effort: each
 * matching GEAI gets a tunnel `deliver`; if it is offline the push is dropped. The grant is re-checked
 * live here (the GEAI must still exist and be active/approved).
 */
export async function emitOutboundEcosystemEvent(
  storage: Storage, config: AimeatConfig, ownerGhii: string, event: string, payload: Record<string, unknown>,
): Promise<void> {
  let subs: EcosystemSubscription[];
  try { subs = await readEcosystemSubscriptions(storage, config.nodeId); }
  catch (err) { logger.error('readEcosystemSubscriptions failed', { event, error: String(err) }); return; }

  const candidates = subs.filter(s => s.ownerGhii === ownerGhii && (s.event === event || s.event === '*') && matchPasses(s.match, payload));
  for (const sub of candidates) {
    // Live grant re-check — a revoked / missing GEAI stops receiving immediately.
    const app = await storage.getEcosystemApp(sub.geai).catch(err => { logger.warn('emitOutboundEcosystemEvent: continuing after a suppressed failure', { error: String(err) }); return null; });
    if (!app || (app.status !== 'active' && app.status !== 'approved')) continue;
    if (!sub.transport.includes('tunnel')) continue; // webhook-only subs are no-ops this chunk (fallback deferred)
    const envelope = buildEcosystemEnvelope(event, config.nodeId, sub.geai, payload);
    emitDelivery({ target: sub.geai, kind: event, id: `${event}:${randomUUID()}`, payload: envelope });
  }
}

/** Outbound `memory.write` — fired at the memory write site for any GEAI watching the owner's keys. */
export async function emitEcosystemMemoryWrite(storage: Storage, config: AimeatConfig, writerIdentity: string, key: string): Promise<void> {
  const owner = parseGaiiLoose(writerIdentity).owner;
  if (!owner) return;
  const ownerGhii = `${owner}@${config.nodeId}`;
  await emitOutboundEcosystemEvent(storage, config, ownerGhii, 'memory.write', { key, owner_gaii: writerIdentity });
}

/** Outbound `binding.revoked` — lifecycle event sent when the owner revokes a GEAI. */
export async function emitEcosystemBindingRevoked(storage: Storage, config: AimeatConfig, ownerGhii: string, geai: string, reason: string): Promise<void> {
  await emitOutboundEcosystemEvent(storage, config, ownerGhii, 'binding.revoked', { geai, reason });
}

// ── inbound audit log (per-GEAI, capped) ──
export async function appendInboundEcosystemLog(storage: Storage, geai: string, entry: { event: string; version: number; timestamp: string; data: Record<string, unknown> }): Promise<void> {
  try {
    const existing = await storage.getMemory(geai, INBOUND_LOG_KEY);
    const arr = Array.isArray(existing?.value) ? (existing!.value as unknown[]) : [];
    arr.push({ id: randomUUID(), ...entry, receivedAt: new Date().toISOString() });
    const trimmed = arr.slice(-INBOUND_LOG_KEEP);
    const now = new Date().toISOString();
    await storage.setMemory({
      key: INBOUND_LOG_KEY, ownerGaii: geai, value: trimmed,
      visibility: 'private', tags: ['ecosystem-inbound'], ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
  } catch (err) {
    logger.error('appendInboundEcosystemLog failed', { geai, error: String(err) });
  }
}
