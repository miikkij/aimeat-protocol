/**
 * @file outbound.repository.ts
 * @description Repository contract for the outbound door: recipient registry CRUD and
 *   the append-only send log with the counters the daily limit is enforced from.
 *   Same discipline as finance.repository.ts: no method applies authorization, and
 *   the send-log counter counts in SQL because it is a GATE.
 * @usage Storage interface composes this; providers implement in methods/outbound.ts.
 * @version-history
 *   v1.1.0 — 2026-08-17 — TARGET-063: findUnresolvedOutboundContactsByEmailHash, the promotion
 *     lookup. Deliberately its own method rather than a flag on OutboundContactQuery: the query
 *     type is what the /v1/outbound routes build from request input, and this one is cross-owner.
 *     A shape a route can reach is a shape a route can be made to leak.
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 2: outbound door.
 */
import type {
  OutboundContactRecord, OutboundContactQuery,
  OutboundMessageRecord, OutboundLogQuery,
} from '../../models/outbound-schemas.js';

export interface OutboundRepository {
  // ── Contacts ──────────────────────────────────────────────────────────────
  createOutboundContact(row: OutboundContactRecord): Promise<void>;
  getOutboundContact(id: string): Promise<OutboundContactRecord | undefined>;
  /** Dedupe lookup by the natural key (one entry per owner per address). */
  findOutboundContactByEmail(ownerGhii: string, email: string): Promise<OutboundContactRecord | undefined>;
  /** Public unsubscribe resolves the token, never an id. */
  findOutboundContactByToken(optOutToken: string): Promise<OutboundContactRecord | undefined>;
  /**
   * Promotion lookup: every contact across ALL owners that carries this email hash and has no
   * AIMEAT identity yet. Called only when someone has just PROVEN that address on this node, so
   * the hash is already known to the caller and nothing is disclosed by asking.
   * Server-internal — no route reaches this.
   */
  findUnresolvedOutboundContactsByEmailHash(emailHash: string): Promise<OutboundContactRecord[]>;
  listOutboundContacts(query: OutboundContactQuery): Promise<OutboundContactRecord[]>;
  countOutboundContacts(query: OutboundContactQuery): Promise<number>;
  /** Full-row update (service merges; opt-out/bounce fields flow through here). */
  updateOutboundContact(row: OutboundContactRecord): Promise<void>;
  deleteOutboundContact(id: string): Promise<boolean>;

  // ── Send log (append-only) ────────────────────────────────────────────────
  createOutboundMessage(row: OutboundMessageRecord): Promise<void>;
  listOutboundMessages(query: OutboundLogQuery): Promise<OutboundMessageRecord[]>;
  countOutboundMessages(query: OutboundLogQuery): Promise<number>;
  /** The daily-limit gate: sent messages for one owner since an ISO timestamp. */
  countOutboundMessagesSince(ownerGhii: string, sinceIso: string): Promise<number>;
}
