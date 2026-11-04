/**
 * @file src/services/settlement-ceiling.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How many morsels a federation peer's signed settlements may credit on this node in one
 *   UTC day (the developer's ruling 3 of 2026-10-31, secaudit2026oct31w2 round 10, W2-4).
 *
 *   WHAT IT BOUNDS. POST /v1/federation/settle credits morsels that no balance on this node paid: they
 *   are added from nothing, like an operator's mint or a sold pacing pack (services/mint-ceiling.ts).
 *   Those two share the node's daily ceiling, AIMEAT_MAX_OPERATOR_MINT_PER_DAY; a peer's settlement had
 *   no bound at all. Now:
 *     - a peer on the node's setting (the default): its settlement fits in what is left today of the
 *       node's daily ceiling, counting mints, pack sales and every peer's settlements together. The
 *       operator's mint and a pack sale do not count settlements, so a peer never takes their room.
 *     - a peer the operator gave its own ceiling: its own settlements today, at most that many.
 *     - a peer the operator gave no limit ('none'): as before this change.
 *   The setting is a record in the system namespace `federation-settlement` (`ceiling.<nodeId>`), set
 *   through the peer policy: PUT /v1/federation/peers/:nodeId (settlement_ceiling), PUT
 *   /v1/federation/peers/:nodeId/settlement-ceiling, aimeat_admin_federation_settlement_ceiling_set and
 *   its CLI twin, and the Federation page.
 *
 *   NOTHING LOST SILENTLY. A settlement the ceiling refuses is answered 429 QUOTA_EXCEEDED with the
 *   reason, so the sending operator reads it, and recorded here: one record per peer and day
 *   (`refused.<nodeId>.<day>`, the last 50 refused settlements and the day's totals), one Security
 *   page incident per peer and day that carries the totals, and one notice to every operator on the
 *   first refusal of the day. Nothing is credited, and the tracking code stays unused, so the sending
 *   node may send it again once the operator raised the ceiling.
 * @structure NS_SETTLEMENT · SettlementCeilingSetting · parseSettlementCeiling · peerSettlementCeiling ·
 *   setPeerSettlementCeiling · settlementRoom · recordRefusedSettlement · forgetPeerSettlementCeiling
 * @usage const room = await settlementRoom(config, storage, from_node, amount);
 *        if (!room.ok) { await recordRefusedSettlement(config, storage, {...}); refuse(429); }
 * @version-history
 *   2026-11-04 — No plain setMemory for a storage without setMemoryIfVersion or createMemoryIfAbsent:
 *     both are required on Storage (codebase analysis 2026-11-03, item D-e).
 *   v1.0.0 — 2026-10-31 — Initial (secaudit2026oct31w2 round 10, W2-4,
 *     federation-settlements.ts:settle:peer-credit-not-bound-to-obligation).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { DAILY_ADDED_TYPES } from './mint-ceiling.js';
import { recordSecurityIncident, findSecurityIncident, saveSecurityIncident, type SecurityIncidentValue } from './security-incident.js';
import { notify } from './notify.js';
import { listOperatorGhiis } from './operators.js';
import { logger } from '../utils/logger.js';

/** The system namespace of the per-peer ceilings and the refused-settlement records. */
export const NS_SETTLEMENT = 'federation-settlement';

/** A peer's own setting: a whole number of morsels a day, 'none' for no limit, or null for the node's. */
export type SettlementCeilingSetting = number | 'none' | null;

const ceilingKey = (nodeId: string): string => `ceiling.${nodeId}`;
const refusedKey = (nodeId: string, day: string): string => `refused.${nodeId}.${day}`;
const FEDERATION_PAGE = '/v1/admin?tab=federation';
/** Refused settlements kept by value in one peer's record for one day; the totals count them all. */
const KEEP_ITEMS = 50;
/** Peers a day that get a Security page incident and a notice; beyond it the refusal is recorded and logged. */
const INCIDENT_PEERS_PER_DAY = 50;
/** The largest ceiling the setting takes: a number no ledger reaches, below what a JS number keeps exact. */
const MAX_CEILING = 1_000_000_000_000;

export const SETTLEMENT_REFUSED_TYPE = 'federation_settlement_refused';

/** The UTC day of a moment, as YYYY-MM-DD, and the moment it began. */
function utcDay(now: Date = new Date()): { day: string; since: string } {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return { day: start.toISOString().slice(0, 10), since: start.toISOString() };
}

/** Read the words a caller sends: a positive whole number (or its digits), 'none', or 'node' / null. */
export function parseSettlementCeiling(raw: unknown):
  | { ok: true; value: SettlementCeilingSetting }
  | { ok: false; message: string } {
  if (raw === null || raw === 'node') return { ok: true, value: null };
  if (raw === 'none') return { ok: true, value: 'none' };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (Number.isInteger(n) && n >= 1 && n <= MAX_CEILING) return { ok: true, value: n };
  return {
    ok: false,
    message: 'settlement_ceiling is a whole number of morsels a day (at least 1), "none" for no limit, or "node" to follow this node\'s daily ceiling. To stop a peer settling at all, turn allow_settlement off.',
  };
}

/** The peer's own setting, or null when it follows the node. */
export async function peerSettlementCeiling(storage: Storage, nodeId: string): Promise<SettlementCeilingSetting> {
  const rec = await storage.getMemory(NS_SETTLEMENT, ceilingKey(nodeId));
  const v = (rec?.value as { ceiling?: unknown } | undefined)?.ceiling;
  if (v === 'none') return 'none';
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
}

/** Morsels the peer's settlements credited since the start of the UTC day. */
async function creditedTodayBy(storage: Storage, nodeId: string): Promise<number> {
  return storage.sumTransactionsSince(['federation_settlement'], utcDay().since, nodeId);
}

/** One peer's ceiling as the peer list, the route and the tool show it. */
export interface PeerSettlementCeilingView {
  /** The operator's setting for this peer: a number, 'none', or null for the node's. */
  setting: SettlementCeilingSetting;
  /** The ceiling that applies, in morsels a day; null when there is no limit. */
  daily_limit: number | null;
  /** 'peer' when the peer has its own number, 'node' when it shares the node's, 'none' for no limit. */
  counts_against: 'peer' | 'node' | 'none';
  /** What this peer's settlements credited since the start of the UTC day. */
  credited_today: number;
}

export async function peerSettlementCeilingView(config: Pick<AimeatConfig, 'maxOperatorMintPerDay'>, storage: Storage, nodeId: string): Promise<PeerSettlementCeilingView> {
  const setting = await peerSettlementCeiling(storage, nodeId);
  return {
    setting,
    daily_limit: setting === 'none' ? null : typeof setting === 'number' ? setting : config.maxOperatorMintPerDay,
    counts_against: setting === 'none' ? 'none' : typeof setting === 'number' ? 'peer' : 'node',
    credited_today: await creditedTodayBy(storage, nodeId),
  };
}

/** What this module needs of a peer: its node id. Not services/federation.ts PeerInfo, which would
 *  close an import cycle through peer-origin.ts. */
interface PeerRef { nodeId: string }

export type SetPeerSettlementCeilingResult =
  | { ok: true; peer: PeerRef; view: PeerSettlementCeilingView }
  | { ok: false; status: number; code: 'INVALID_INPUT' | 'NOT_FOUND'; message: string };

/**
 * The one implementation behind PUT /v1/federation/peers/:nodeId/settlement-ceiling,
 * settlement_ceiling on PUT /v1/federation/peers/:nodeId and
 * aimeat_admin_federation_settlement_ceiling_set. Refuses before it writes.
 */
export async function setPeerSettlementCeiling(
  config: Pick<AimeatConfig, 'maxOperatorMintPerDay'>,
  storage: Storage,
  peers: ReadonlyMap<string, PeerRef>,
  nodeId: string,
  raw: unknown,
  by: string,
): Promise<SetPeerSettlementCeilingResult> {
  const parsed = parseSettlementCeiling(raw);
  if (!parsed.ok) return { ok: false, status: 400, code: 'INVALID_INPUT', message: parsed.message };
  const peer = peers.get(nodeId) ?? [...peers.values()].find(p => p.nodeId === nodeId);
  if (!peer) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Peer not found: ${nodeId}` };
  await writePeerSettlementCeiling(storage, peer.nodeId, parsed.value, by);
  return { ok: true, peer, view: await peerSettlementCeilingView(config, storage, peer.nodeId) };
}

/** Store a parsed setting: null removes the peer's own record, so it follows the node again. */
export async function writePeerSettlementCeiling(storage: Storage, nodeId: string, value: SettlementCeilingSetting, by: string): Promise<void> {
  if (value === null) { await storage.deleteMemory(NS_SETTLEMENT, ceilingKey(nodeId)); return; }
  const now = new Date().toISOString();
  const existing = await storage.getMemory(NS_SETTLEMENT, ceilingKey(nodeId));
  await storage.setMemory({
    key: ceilingKey(nodeId), ownerGaii: NS_SETTLEMENT,
    value: { nodeId, ceiling: value, set_by: by, set_at: now },
    visibility: 'private', tags: ['federation-settlement-ceiling'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/** A removed peer's ceiling goes with it, so a node that peers again under the id starts on the node's. */
export async function forgetPeerSettlementCeiling(storage: Storage, nodeId: string): Promise<void> {
  await storage.deleteMemory(NS_SETTLEMENT, ceilingKey(nodeId));
}

export type SettlementRoom =
  | { ok: true }
  | { ok: false; limit: number; used: number; countsAgainst: 'peer' | 'node' };

/**
 * Whether a settlement of `amount` from `nodeId` fits today. Asked after the signature, the timestamp
 * and the replay checks and before the credit, inside the route's one-at-a-time section.
 */
export async function settlementRoom(
  config: Pick<AimeatConfig, 'maxOperatorMintPerDay'>,
  storage: Storage,
  nodeId: string,
  amount: number,
): Promise<SettlementRoom> {
  const setting = await peerSettlementCeiling(storage, nodeId);
  if (setting === 'none') return { ok: true };
  const { since } = utcDay();
  if (typeof setting === 'number') {
    const used = await storage.sumTransactionsSince(['federation_settlement'], since, nodeId);
    return used + amount > setting ? { ok: false, limit: setting, used, countsAgainst: 'peer' } : { ok: true };
  }
  const used = await storage.sumTransactionsSince([...DAILY_ADDED_TYPES, 'federation_settlement'], since);
  const limit = config.maxOperatorMintPerDay;
  return used + amount > limit ? { ok: false, limit, used, countsAgainst: 'node' } : { ok: true };
}

/** The words of a 429 for the sending node. */
export function settlementRefusalMessage(room: Extract<SettlementRoom, { ok: false }>, amount: number): string {
  const whose = room.countsAgainst === 'peer' ? 'the daily ceiling this node set for your node' : 'this node\'s daily ceiling on morsels added from nothing';
  return `This settlement of ${amount} morsels would pass ${whose} (${room.limit} morsels; ${room.used} already added today). Nothing was credited and the tracking code is still unused. This node's operator was told and can raise the ceiling for your node; send it again after that, or after midnight UTC.`;
}

export interface RefusedSettlement {
  fromNode: string;
  gaii: string;
  amount: number;
  trackingCode: string;
  reason?: string;
  room: Extract<SettlementRoom, { ok: false }>;
}

interface SettlementRefusals {
  nodeId: string;
  day: string;
  refusedSettlements: number;
  refusedMorsels: number;
  incident: string | null;
  items: Array<{ gaii: string; amount: number; tracking_code: string; reason: string | null; at: string }>;
}

/**
 * Record a refused settlement: the peer's record for the day, the Security page incident (one per peer
 * and day, its totals brought up to date), and on the day's first refusal a notice to every operator.
 * Never throws: the refusal has been decided, and recording it must not turn it into a 500.
 */
export async function recordRefusedSettlement(config: AimeatConfig, storage: Storage, r: RefusedSettlement): Promise<void> {
  try {
    const { day } = utcDay();
    const key = refusedKey(r.fromNode, day);
    const now = new Date().toISOString();
    const item = { gaii: r.gaii, amount: r.amount, tracking_code: r.trackingCode, reason: r.reason ?? null, at: now };
    const fresh: SettlementRefusals = { nodeId: r.fromNode, day, refusedSettlements: 1, refusedMorsels: r.amount, incident: null, items: [item] };
    const base = {
      key, ownerGaii: NS_SETTLEMENT, visibility: 'private' as const, tags: ['federation-settlement-refused'],
      ttlHours: 24 * 90, createdAt: now, updatedAt: now,
    };
    // The day's first refusal claims the record; a later one updates it on its version.
    let value: SettlementRefusals;
    let first = false;
    const claimed = await storage.createMemoryIfAbsent({ ...base, value: fresh, version: 1 });
    if (claimed) {
      value = fresh; first = true;
    } else {
      const existing = await storage.getMemory(NS_SETTLEMENT, key);
      const prev = existing?.value as SettlementRefusals | undefined;
      if (!existing || !prev) {
        value = fresh; first = true;
        await storage.setMemory({ ...base, value, version: 1 });
      } else {
        value = {
          ...prev, refusedSettlements: prev.refusedSettlements + 1, refusedMorsels: prev.refusedMorsels + r.amount,
          items: [...prev.items, item].slice(-KEEP_ITEMS),
        };
        const next = { ...base, createdAt: existing.createdAt, value, version: existing.version + 1 };
        const wrote = await storage.setMemoryIfVersion(next, existing.version);
        // Two refusals at the same moment: the one that lost is still in the log line below.
        if (!wrote) logger.warn('A refused settlement was counted by a concurrent write first', { ...item, from: r.fromNode });
      }
    }
    logger.warn('Federation settlement refused by the daily ceiling', { from: r.fromNode, ...item, limit: r.room.limit, used: r.room.used, counts_against: r.room.countsAgainst });

    const params = {
      node: r.fromNode, day, count: String(value.refusedSettlements), morsels: String(value.refusedMorsels),
      limit: String(r.room.limit), used: String(r.room.used),
    };
    const detail = `Node ${r.fromNode} sent ${value.refusedSettlements} settlement(s) on ${day} (${value.refusedMorsels} morsels in all) that this node refused: `
      + `each would have passed ${r.room.countsAgainst === 'peer' ? 'the ceiling set for that node' : 'the node\'s daily ceiling on morsels added from nothing'} `
      + `(${r.room.limit} morsels a day). Nothing was credited; the latest was ${r.amount} morsels for ${r.gaii}, tracking code ${r.trackingCode}. `
      + `If you trust that node, raise its ceiling (PUT /v1/federation/peers/${r.fromNode}/settlement-ceiling, aimeat_admin_federation_settlement_ceiling_set); its operator can then send the settlements again.`;

    if (value.incident) {
      const rec = await findSecurityIncident(storage, config, value.incident);
      if (rec) await saveSecurityIncident(storage, rec, { ...(rec.value as SecurityIncidentValue), detail, params });
      return;
    }
    if (!first) return;
    const today = await storage.listMemory(NS_SETTLEMENT, { prefix: 'refused.' });
    if (today.filter(x => (x.value as SettlementRefusals | undefined)?.day === day).length > INCIDENT_PEERS_PER_DAY) return;
    const out = await recordSecurityIncident(storage, config, {
      type: 'federation_settlement', code: 'SETTLEMENT_CEILING', actorGhii: r.fromNode, actorName: r.fromNode,
      detail, source: 'federation-settle', params,
    });
    if (out.recorded) {
      const latest = await storage.getMemory(NS_SETTLEMENT, key);
      const v = latest?.value as SettlementRefusals | undefined;
      if (latest && v) {
        const next = { ...base, createdAt: latest.createdAt, value: { ...v, incident: out.id }, version: latest.version + 1 };
        await storage.setMemoryIfVersion(next, latest.version);
      }
    }
    const vars = { node: r.fromNode, amount: r.amount, limit: r.room.limit };
    const title = `A settlement from ${r.fromNode} was refused`;
    const body = `It would have added ${r.amount} morsels, past the daily ceiling of ${r.room.limit}. Nothing was credited. If you trust this node, raise its ceiling on the Federation page; its operator can then send it again.`;
    for (const ghii of await listOperatorGhiis(storage, config)) {
      await notify(storage, ghii, {
        type: SETTLEMENT_REFUSED_TYPE, title, body, link: FEDERATION_PAGE,
        actions: [{ id: 'open', label: 'Open the Federation page', kind: 'navigate', link: FEDERATION_PAGE, i18n: { key: `${SETTLEMENT_REFUSED_TYPE}.open` } }],
        i18n: { key: SETTLEMENT_REFUSED_TYPE, vars },
      });
    }
  } catch (err) {
    logger.warn('recordRefusedSettlement: the record and the notice are best-effort; the refusal stands', { error: String(err), from: r.fromNode });
  }
}
