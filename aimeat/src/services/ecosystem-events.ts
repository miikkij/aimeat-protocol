/**
 * @file ecosystem-events.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ecosystem-app (GEAI) event plane: the per-GEAI OUTBOUND subscription registry and
 *   the best-effort outbound emitter, plus the INBOUND audit log. Outbound events (e.g. memory.write,
 *   binding.revoked) are pushed to a subscribed GEAI over the connect-tunnel via emitDelivery — the
 *   GEAI is just another tunnel identity, so if it is offline the push is dropped (best-effort; the
 *   signed-webhook fallback + at-least-once durable queue are deferred to a later chunk). The grant is
 *   re-checked LIVE at emit time (a revoked GEAI stops receiving immediately). The subscription
 *   registry is system-namespace memory, one record per owner, so a write reads only its owner's list.
 * @structure
 *   - EcosystemSubscription + list/add/remove (system@{nodeId} memory key `ecosystem.subscriptions.of.{owner}`)
 *   - LEGACY_SUBSCRIPTIONS_KEY, ownerSubscriptionsKey, subscriptionOwnerOf, subscriptionIdentity,
 *     parseSubscriptions, updateOwnerSubscriptions (shared with the boot move)
 *   - EcosystemSubscriptionsFullError
 *   - emitOutboundEcosystemEvent / emitEcosystemMemoryWrite / emitEcosystemBindingRevoked
 *   - appendInboundEcosystemLog (per-GEAI capped audit log)
 * @usage import { emitEcosystemMemoryWrite } from '../services/ecosystem-events.js';
 * @version-history
 *   v1.1.0 — 2026-11-01 — The subscriptions are kept per owner (`ecosystem.subscriptions.of.{owner}`),
 *     so a memory write reads only its owner's list and no account grows what every write on the node
 *     reads; written on the version read (record-cas); addSubscription takes maxBytes
 *     (secaudit2026oct31w2 round 12, ecosystem-subscriptions:node-wide-registry-unbounded-size).
 *   v1.0.0 — 2026-06-14 — Created for ecosystem events & triggers (chunk 2).
 *   v1.0.1 — 2026-09-26 — emitEcosystemMemoryWrite names the writer's account with localAccountOf, so a
 *     visitor's write is never announced to the local namesake's apps (secaudit 2026-09, F-1).
 *   v1.0.2 — 2026-10-18 — appendInboundEcosystemLog appends with updateRecord, on the version it read.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { emitDelivery } from './event-bus.js';
import { buildEcosystemEnvelope } from '../models/ecosystem-event-schemas.js';
import { globToRegExp } from './workflow/signal-eval.js';
import { localAccountOf } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { updateRecord, UNCHANGED } from './record-cas.js';

/** The node-wide record every account's subscriptions lived in before 2026-11-01; read only by the boot move. */
export const LEGACY_SUBSCRIPTIONS_KEY = 'ecosystem.subscriptions';
const OWNER_SUBSCRIPTIONS_PREFIX = 'ecosystem.subscriptions.of.';
const SUBSCRIPTIONS_TAG = 'ecosystem-index';
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

/** Refused by addSubscription: the owner's list would pass the node's memory value size. */
export class EcosystemSubscriptionsFullError extends Error {
  constructor(public readonly bytes: number, public readonly maxBytes: number) {
    super(`The subscription list would hold ${bytes} bytes, past the limit of ${maxBytes} bytes`);
    this.name = 'EcosystemSubscriptionsFullError';
  }
}

// ── subscription registry: one system-namespace record per owner ──
// Every memory write on the node reads the writer's owner's record, so one account's list costs only
// that account's writes (secaudit2026oct31w2 round 12). Until 2026-11-01 all accounts shared one record
// (LEGACY_SUBSCRIPTIONS_KEY); services/ecosystem-subscriptions-by-owner.ts moves it once at boot.

/** The system record that holds one owner's subscriptions. */
export function ownerSubscriptionsKey(owner: string): string { return `${OWNER_SUBSCRIPTIONS_PREFIX}${owner}`; }

/** The local account of an owner GHII on this node, or null for any other identity. */
export function subscriptionOwnerOf(ownerGhii: string, nodeId: string): string | null {
  const suffix = `@${nodeId}`;
  if (!ownerGhii.endsWith(suffix)) return null;
  const owner = ownerGhii.slice(0, -suffix.length);
  return owner && !owner.includes('@') && !owner.includes('#') ? owner : null;
}

/** The identity of one subscription: a second add with the same geai, event and match replaces it. */
export function subscriptionIdentity(s: { geai: string; event: string; match?: Record<string, string> }): string {
  return `${s.geai}|${s.event}|${JSON.stringify(s.match ?? {})}`;
}

/** A stored list as subscriptions: the entries that have the fields the emitter reads. */
export function parseSubscriptions(value: unknown): EcosystemSubscription[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is EcosystemSubscription => !!s && typeof s === 'object'
    && typeof (s as EcosystemSubscription).geai === 'string' && typeof (s as EcosystemSubscription).ownerGhii === 'string'
    && typeof (s as EcosystemSubscription).event === 'string' && Array.isArray((s as EcosystemSubscription).transport));
}

async function readOwnerSubscriptions(storage: Storage, nodeId: string, ownerGhii: string): Promise<EcosystemSubscription[]> {
  const owner = subscriptionOwnerOf(ownerGhii, nodeId);
  if (!owner) return [];
  const rec = await storage.getMemory(systemGhiiFor(nodeId), ownerSubscriptionsKey(owner));
  return parseSubscriptions(rec?.value).filter(s => s.ownerGhii === ownerGhii);
}

/**
 * Change one owner's list on the version that was read (record-cas). `mutate` answers UNCHANGED to
 * write nothing. Answers the list as stored.
 */
export async function updateOwnerSubscriptions(
  storage: Storage, nodeId: string, owner: string,
  mutate: (cur: EcosystemSubscription[]) => EcosystemSubscription[] | typeof UNCHANGED,
): Promise<EcosystemSubscription[]> {
  return updateRecord(storage, systemGhiiFor(nodeId), ownerSubscriptionsKey(owner), parseSubscriptions, mutate, { tag: SUBSCRIPTIONS_TAG });
}

/** List an owner's subscriptions (optionally for one GEAI). */
export async function listSubscriptions(storage: Storage, nodeId: string, ownerGhii: string, geai?: string): Promise<EcosystemSubscription[]> {
  const own = await readOwnerSubscriptions(storage, nodeId, ownerGhii);
  return own.filter(s => !geai || s.geai === geai);
}

/**
 * Add a subscription (idempotent on {geai,event,match}). Returns the stored entry. With `maxBytes`,
 * a list that would pass it is refused with EcosystemSubscriptionsFullError and nothing is written.
 */
export async function addSubscription(
  storage: Storage, nodeId: string, sub: Omit<EcosystemSubscription, 'createdAt'>, opts: { maxBytes?: number } = {},
): Promise<EcosystemSubscription> {
  const owner = subscriptionOwnerOf(sub.ownerGhii, nodeId);
  if (!owner) throw new Error(`A subscription belongs to an account of this node, not ${sub.ownerGhii}`);
  const entry: EcosystemSubscription = { ...sub, createdAt: new Date().toISOString() };
  await updateOwnerSubscriptions(storage, nodeId, owner, cur => {
    const next = [...cur.filter(s => subscriptionIdentity(s) !== subscriptionIdentity(sub)), entry];
    if (opts.maxBytes) {
      const bytes = Buffer.byteLength(JSON.stringify(next), 'utf8');
      if (bytes > opts.maxBytes) throw new EcosystemSubscriptionsFullError(bytes, opts.maxBytes);
    }
    return next;
  });
  return entry;
}

/** Remove subscriptions for a GEAI (optionally only one event). Returns the count removed. */
export async function removeSubscriptions(storage: Storage, nodeId: string, ownerGhii: string, geai: string, event?: string): Promise<number> {
  const owner = subscriptionOwnerOf(ownerGhii, nodeId);
  if (!owner) return 0;
  let removed = 0;
  await updateOwnerSubscriptions(storage, nodeId, owner, cur => {
    const next = cur.filter(s => !(s.ownerGhii === ownerGhii && s.geai === geai && (!event || s.event === event)));
    removed = cur.length - next.length;
    return removed ? next : UNCHANGED;
  });
  return removed;
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
  try { subs = await readOwnerSubscriptions(storage, config.nodeId, ownerGhii); }
  catch (err) { logger.error('readOwnerSubscriptions failed', { event, error: String(err) }); return; }

  const candidates = subs.filter(s => (s.event === event || s.event === '*') && matchPasses(s.match, payload));
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
  // A writer from another node has no account here, so its write reaches no app of the local namesake.
  const owner = writerIdentity.includes('@') ? localAccountOf(writerIdentity) : null;
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
    const line = { id: randomUUID(), ...entry, receivedAt: new Date().toISOString() };
    // Appended to the log as stored, on its version (updateRecord): two events at once both land.
    await updateRecord(storage, geai, INBOUND_LOG_KEY,
      v => (Array.isArray(v) ? v as unknown[] : []),
      arr => [...arr, line].slice(-INBOUND_LOG_KEEP),
      { tag: 'ecosystem-inbound' });
  } catch (err) {
    logger.error('appendInboundEcosystemLog failed', { geai, error: String(err) });
  }
}
