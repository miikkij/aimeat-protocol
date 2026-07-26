/**
 * @file src/storage/providers/sqlite/methods/community.ts
 * @description Membership, Join-request, Approval, Appeal, Marketplace, Push, Issuer, Nonce, Genesis-peer, Reputation, Realtime-room methods. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
 *   v1.2.0 — 2026-07-16 — Memberships carry invitedWorkspaces (JSON column): workspace grants chosen at invite time.
 *   v1.1.0 — 2026-07-16 — Add listPendingApprovalsForOrgs batch (Phase 3): pending approvals for many orgs
 *     in one organismId-IN query.
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 */
import type {
  OrganismMembershipRecord, JoinRequestRecord, PendingApprovalRecord, AppealRecord, ListingRecord, PurchaseRecord,
  PushSubscriptionRecord, TrustedIssuerRecord, VerificationNonceRecord, GenesisPeerRecord, OrganismReputationRecord, RealtimeRoomRecord
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import { logger } from '../../../../utils/logger.js';

export const communityMethods = {
  // ── Memberships ──
  // ══════════════════════════════════════════════════════════

  async createMembership(this: SqliteStorage, record: OrganismMembershipRecord): Promise<OrganismMembershipRecord> {
    this.db.prepare(
      `INSERT INTO organism_memberships (id, organismId, ghii, role, status, joinedAt, invitedBy, invitedWorkspaces)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.organismId, record.ghii, record.role,
      record.status, record.joinedAt, record.invitedBy ?? null,
      record.invitedWorkspaces?.length ? JSON.stringify(record.invitedWorkspaces) : null,
    );
    return record;
  },

  async getMembership(this: SqliteStorage, organismId: string, ghii: string): Promise<OrganismMembershipRecord | null> {
    const row = this.db.prepare('SELECT * FROM organism_memberships WHERE organismId = ? AND ghii = ?').get(organismId, ghii) as Record<string, unknown> | undefined;
    return row ? this.deserializeMembership(row) : null;
  },

  async listMembers(this: SqliteStorage, organismId: string, opts?: { role?: string; status?: string }): Promise<OrganismMembershipRecord[]> {
    let sql = 'SELECT * FROM organism_memberships WHERE organismId = ?';
    const params: unknown[] = [organismId];
    if (opts?.role) { sql += ' AND role = ?'; params.push(opts.role); }
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMembership(r));
  },

  async listMembershipsByGhii(this: SqliteStorage, ghii: string): Promise<OrganismMembershipRecord[]> {
    const rows = this.db.prepare('SELECT * FROM organism_memberships WHERE ghii = ?').all(ghii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMembership(r));
  },

  async updateMembership(this: SqliteStorage, id: string, updates: Partial<OrganismMembershipRecord>): Promise<OrganismMembershipRecord | null> {
    const row = this.db.prepare('SELECT * FROM organism_memberships WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const existing = this.deserializeMembership(row);
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE organism_memberships SET organismId = ?, ghii = ?, role = ?, status = ?, joinedAt = ?, invitedBy = ?, invitedWorkspaces = ? WHERE id = ?`
    ).run(
      updated.organismId, updated.ghii, updated.role, updated.status,
      updated.joinedAt, updated.invitedBy ?? null,
      updated.invitedWorkspaces?.length ? JSON.stringify(updated.invitedWorkspaces) : null, id,
    );
    return updated;
  },

  async deleteMembership(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM organism_memberships WHERE id = ?').run(id);
    return result.changes > 0;
  },

  deserializeMembership(this: SqliteStorage, row: Record<string, unknown>): OrganismMembershipRecord {
    const record: OrganismMembershipRecord = {
      id: row.id as string,
      organismId: row.organismId as string,
      ghii: row.ghii as string,
      role: row.role as OrganismMembershipRecord['role'],
      status: row.status as OrganismMembershipRecord['status'],
      joinedAt: row.joinedAt as string,
    };
    if (row.invitedBy) record.invitedBy = row.invitedBy as string;
    if (row.invitedWorkspaces) {
      try {
        record.invitedWorkspaces = JSON.parse(row.invitedWorkspaces as string);
      } catch (err) {
        // Dropping this silently means an invite that grants NO workspaces looks like an invite
        // that was never meant to grant any. Name the row instead.
        logger.warn('Membership row has malformed invitedWorkspaces JSON; the invite grants no workspaces', { id: row.id, error: (err as Error).message });
      }
    }
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Join Requests ──
  // ══════════════════════════════════════════════════════════

  async createJoinRequest(this: SqliteStorage, record: JoinRequestRecord): Promise<JoinRequestRecord> {
    this.db.prepare(
      `INSERT INTO join_requests (id, organismId, ghii, message, status, reviewedBy, createdAt, reviewedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.organismId, record.ghii, record.message ?? null,
      record.status, record.reviewedBy ?? null, record.createdAt, record.reviewedAt ?? null,
    );
    return record;
  },

  async getJoinRequest(this: SqliteStorage, id: string): Promise<JoinRequestRecord | null> {
    const row = this.db.prepare('SELECT * FROM join_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeJoinRequest(row) : null;
  },

  async listJoinRequests(this: SqliteStorage, organismId: string, opts?: { status?: string }): Promise<JoinRequestRecord[]> {
    let sql = 'SELECT * FROM join_requests WHERE organismId = ?';
    const params: unknown[] = [organismId];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeJoinRequest(r));
  },

  async updateJoinRequest(this: SqliteStorage, id: string, updates: Partial<JoinRequestRecord>): Promise<JoinRequestRecord | null> {
    const existing = await this.getJoinRequest(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE join_requests SET organismId = ?, ghii = ?, message = ?, status = ?,
       reviewedBy = ?, createdAt = ?, reviewedAt = ? WHERE id = ?`
    ).run(
      updated.organismId, updated.ghii, updated.message ?? null,
      updated.status, updated.reviewedBy ?? null,
      updated.createdAt, updated.reviewedAt ?? null, id,
    );
    return updated;
  },

  deserializeJoinRequest(this: SqliteStorage, row: Record<string, unknown>): JoinRequestRecord {
    const record: JoinRequestRecord = {
      id: row.id as string,
      organismId: row.organismId as string,
      ghii: row.ghii as string,
      status: row.status as JoinRequestRecord['status'],
      createdAt: row.createdAt as string,
    };
    if (row.message) record.message = row.message as string;
    if (row.reviewedBy) record.reviewedBy = row.reviewedBy as string;
    if (row.reviewedAt) record.reviewedAt = row.reviewedAt as string;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Pending Approvals (Phase 4 — Gate primitive) ──
  // ══════════════════════════════════════════════════════════

  async createPendingApproval(this: SqliteStorage, record: PendingApprovalRecord): Promise<PendingApprovalRecord> {
    this.db.prepare(
      `INSERT INTO pending_approvals (id, organismId, flowGateId, stageId, actor, action, arguments,
         risk, approverRole, prompt, status, decidedBy, decidedAt, resolutionNote, deadline, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.organismId, record.flowGateId ?? null, record.stageId ?? null,
      record.actor, record.action, record.arguments !== undefined ? JSON.stringify(record.arguments) : null,
      record.risk, record.approverRole, record.prompt ?? null, record.status,
      record.decidedBy ?? null, record.decidedAt ?? null, record.resolutionNote ?? null,
      record.deadline ?? null, record.createdAt, record.updatedAt,
    );
    return record;
  },

  async getPendingApproval(this: SqliteStorage, id: string): Promise<PendingApprovalRecord | null> {
    const row = this.db.prepare('SELECT * FROM pending_approvals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializePendingApproval(row) : null;
  },

  async listPendingApprovals(this: SqliteStorage, organismId: string, opts?: { status?: string }): Promise<PendingApprovalRecord[]> {
    let sql = 'SELECT * FROM pending_approvals WHERE organismId = ?';
    const params: unknown[] = [organismId];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    sql += ' ORDER BY createdAt DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializePendingApproval(r));
  },

  // BULK (Phase 3) — pending approvals for MANY organisms in ONE `organismId IN (…)` query, grouped by org.
  async listPendingApprovalsForOrgs(this: SqliteStorage, organismIds: string[], opts?: { status?: string }): Promise<Record<string, PendingApprovalRecord[]>> {
    if (organismIds.length === 0) return {};
    const ph = organismIds.map(() => '?').join(',');
    let sql = `SELECT * FROM pending_approvals WHERE organismId IN (${ph})`;
    const params: unknown[] = [...organismIds];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    sql += ' ORDER BY createdAt DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const out: Record<string, PendingApprovalRecord[]> = {};
    for (const r of rows) { const rec = this.deserializePendingApproval(r); (out[rec.organismId] ??= []).push(rec); }
    return out;
  },

  async updatePendingApproval(this: SqliteStorage, id: string, updates: Partial<PendingApprovalRecord>): Promise<PendingApprovalRecord | null> {
    const existing = await this.getPendingApproval(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE pending_approvals SET organismId = ?, flowGateId = ?, stageId = ?, actor = ?, action = ?,
         arguments = ?, risk = ?, approverRole = ?, prompt = ?, status = ?, decidedBy = ?, decidedAt = ?,
         resolutionNote = ?, deadline = ?, createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.organismId, updated.flowGateId ?? null, updated.stageId ?? null, updated.actor, updated.action,
      updated.arguments !== undefined ? JSON.stringify(updated.arguments) : null, updated.risk, updated.approverRole,
      updated.prompt ?? null, updated.status, updated.decidedBy ?? null, updated.decidedAt ?? null,
      updated.resolutionNote ?? null, updated.deadline ?? null, updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  },

  async listOverduePendingApprovals(this: SqliteStorage, nowIso: string): Promise<PendingApprovalRecord[]> {
    const rows = this.db.prepare(
      `SELECT * FROM pending_approvals WHERE status = 'pending' AND deadline IS NOT NULL AND deadline < ?`
    ).all(nowIso) as Record<string, unknown>[];
    return rows.map(r => this.deserializePendingApproval(r));
  },

  deserializePendingApproval(this: SqliteStorage, row: Record<string, unknown>): PendingApprovalRecord {
    const record: PendingApprovalRecord = {
      id: row.id as string,
      organismId: row.organismId as string,
      actor: row.actor as string,
      action: row.action as string,
      risk: row.risk as PendingApprovalRecord['risk'],
      approverRole: row.approverRole as PendingApprovalRecord['approverRole'],
      status: row.status as PendingApprovalRecord['status'],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.flowGateId) record.flowGateId = row.flowGateId as string;
    if (row.stageId) record.stageId = row.stageId as string;
    if (row.arguments) record.arguments = JSON.parse(row.arguments as string);
    if (row.prompt) record.prompt = row.prompt as string;
    if (row.decidedBy) record.decidedBy = row.decidedBy as string;
    if (row.decidedAt) record.decidedAt = row.decidedAt as string;
    if (row.resolutionNote) record.resolutionNote = row.resolutionNote as string;
    if (row.deadline) record.deadline = row.deadline as string;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Appeals ──
  // ══════════════════════════════════════════════════════════

  async createAppeal(this: SqliteStorage, record: AppealRecord): Promise<AppealRecord> {
    this.db.prepare(
      `INSERT INTO appeals (id, flagId, appealedBy, reason, status, reviewedBy, reviewNote, createdAt, reviewedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.flagId, record.appealedBy, record.reason,
      record.status, record.reviewedBy ?? null,
      record.reviewNote ?? null, record.createdAt, record.reviewedAt ?? null,
    );
    return record;
  },

  async getAppeal(this: SqliteStorage, id: string): Promise<AppealRecord | null> {
    const row = this.db.prepare('SELECT * FROM appeals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppeal(row) : null;
  },

  async getAppealByFlagId(this: SqliteStorage, flagId: string): Promise<AppealRecord | null> {
    const row = this.db.prepare('SELECT * FROM appeals WHERE flagId = ?').get(flagId) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppeal(row) : null;
  },

  async listAppeals(this: SqliteStorage, opts?: { status?: string; page?: number; perPage?: number }): Promise<AppealRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let sql = 'SELECT * FROM appeals WHERE 1=1';
    const params: unknown[] = [];

    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }

    sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(perPage, (page - 1) * perPage);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppeal(r));
  },

  async updateAppeal(this: SqliteStorage, id: string, updates: Partial<AppealRecord>): Promise<AppealRecord | null> {
    const existing = await this.getAppeal(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE appeals SET flagId = ?, appealedBy = ?, reason = ?, status = ?,
       reviewedBy = ?, reviewNote = ?, createdAt = ?, reviewedAt = ? WHERE id = ?`
    ).run(
      updated.flagId, updated.appealedBy, updated.reason, updated.status,
      updated.reviewedBy ?? null, updated.reviewNote ?? null,
      updated.createdAt, updated.reviewedAt ?? null, id,
    );
    return updated;
  },

  deserializeAppeal(this: SqliteStorage, row: Record<string, unknown>): AppealRecord {
    const record: AppealRecord = {
      id: row.id as string,
      flagId: row.flagId as string,
      appealedBy: row.appealedBy as string,
      reason: row.reason as string,
      status: row.status as AppealRecord['status'],
      createdAt: row.createdAt as string,
    };
    if (row.reviewedBy) record.reviewedBy = row.reviewedBy as string;
    if (row.reviewNote) record.reviewNote = row.reviewNote as string;
    if (row.reviewedAt) record.reviewedAt = row.reviewedAt as string;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Marketplace ──
  // ══════════════════════════════════════════════════════════

  async createListing(this: SqliteStorage, record: ListingRecord): Promise<ListingRecord> {
    this.db.prepare(
      `INSERT INTO listings (id, ownerName, sellerGhii, title, description, category, priceMorsels,
       condition, availability, location, tags, images, status, memoryKey, flagCount, createdAt, updatedAt, semantic)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.ownerName, record.sellerGhii, record.title, record.description,
      record.category, record.priceMorsels,
      record.condition ?? null, record.availability ?? null,
      record.location ? JSON.stringify(record.location) : null,
      record.tags ? JSON.stringify(record.tags) : null,
      record.images ? JSON.stringify(record.images) : null,
      record.status, record.memoryKey, record.flagCount,
      record.createdAt, record.updatedAt,
      record.semantic ? JSON.stringify(record.semantic) : null,
    );
    return record;
  },

  async getListing(this: SqliteStorage, id: string): Promise<ListingRecord | null> {
    const row = this.db.prepare('SELECT * FROM listings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeListing(row) : null;
  },

  async listListings(this: SqliteStorage, opts?: { category?: string; city?: string; minPrice?: number; maxPrice?: number; status?: string; sellerOwner?: string; page?: number; perPage?: number }): Promise<ListingRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;

    const rows = this.db.prepare('SELECT * FROM listings ORDER BY createdAt DESC').all() as Record<string, unknown>[];
    let results = rows.map(r => this.deserializeListing(r));

    if (opts?.category) results = results.filter(l => l.category === opts.category);
    if (opts?.city) results = results.filter(l => l.location?.city?.toLowerCase() === opts.city!.toLowerCase());
    if (opts?.minPrice !== undefined) results = results.filter(l => l.priceMorsels >= opts.minPrice!);
    if (opts?.maxPrice !== undefined) results = results.filter(l => l.priceMorsels <= opts.maxPrice!);
    if (opts?.status) results = results.filter(l => l.status === opts.status);
    if (opts?.sellerOwner) results = results.filter(l => l.ownerName === opts.sellerOwner);

    const start = (page - 1) * perPage;
    return results.slice(start, start + perPage);
  },

  async updateListing(this: SqliteStorage, id: string, updates: Partial<ListingRecord>): Promise<ListingRecord | null> {
    const existing = await this.getListing(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE listings SET ownerName = ?, sellerGhii = ?, title = ?, description = ?,
       category = ?, priceMorsels = ?, condition = ?, availability = ?, location = ?,
       tags = ?, images = ?, status = ?, memoryKey = ?, flagCount = ?,
       createdAt = ?, updatedAt = ?, semantic = ? WHERE id = ?`
    ).run(
      updated.ownerName, updated.sellerGhii, updated.title, updated.description,
      updated.category, updated.priceMorsels,
      updated.condition ?? null, updated.availability ?? null,
      updated.location ? JSON.stringify(updated.location) : null,
      updated.tags ? JSON.stringify(updated.tags) : null,
      updated.images ? JSON.stringify(updated.images) : null,
      updated.status, updated.memoryKey, updated.flagCount,
      updated.createdAt, updated.updatedAt,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      id,
    );
    return updated;
  },

  async deleteListing(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM listings WHERE id = ?').run(id);
    return result.changes > 0;
  },

  async createPurchase(this: SqliteStorage, record: PurchaseRecord): Promise<PurchaseRecord> {
    this.db.prepare(
      `INSERT INTO purchases (id, listingId, buyerOwner, sellerOwner, priceMorsels,
       transactionFeeMorsels, totalCostMorsels, status, rating, trackingCode, createdAt, completedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.listingId, record.buyerOwner, record.sellerOwner,
      record.priceMorsels, record.transactionFeeMorsels, record.totalCostMorsels,
      record.status, record.rating ? JSON.stringify(record.rating) : null,
      record.trackingCode, record.createdAt, record.completedAt ?? null,
    );
    return record;
  },

  async getPurchase(this: SqliteStorage, id: string): Promise<PurchaseRecord | null> {
    const row = this.db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializePurchase(row) : null;
  },

  async listPurchasesByBuyer(this: SqliteStorage, buyerOwner: string): Promise<PurchaseRecord[]> {
    const rows = this.db.prepare('SELECT * FROM purchases WHERE buyerOwner = ? ORDER BY createdAt DESC').all(buyerOwner) as Record<string, unknown>[];
    return rows.map(r => this.deserializePurchase(r));
  },

  async listPurchasesBySeller(this: SqliteStorage, sellerOwner: string): Promise<PurchaseRecord[]> {
    const rows = this.db.prepare('SELECT * FROM purchases WHERE sellerOwner = ? ORDER BY createdAt DESC').all(sellerOwner) as Record<string, unknown>[];
    return rows.map(r => this.deserializePurchase(r));
  },

  async updatePurchase(this: SqliteStorage, id: string, updates: Partial<PurchaseRecord>): Promise<PurchaseRecord | null> {
    const existing = await this.getPurchase(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE purchases SET listingId = ?, buyerOwner = ?, sellerOwner = ?, priceMorsels = ?,
       transactionFeeMorsels = ?, totalCostMorsels = ?, status = ?, rating = ?,
       trackingCode = ?, createdAt = ?, completedAt = ? WHERE id = ?`
    ).run(
      updated.listingId, updated.buyerOwner, updated.sellerOwner,
      updated.priceMorsels, updated.transactionFeeMorsels, updated.totalCostMorsels,
      updated.status, updated.rating ? JSON.stringify(updated.rating) : null,
      updated.trackingCode, updated.createdAt, updated.completedAt ?? null, id,
    );
    return updated;
  },

  deserializeListing(this: SqliteStorage, row: Record<string, unknown>): ListingRecord {
    const record: ListingRecord = {
      id: row.id as string,
      ownerName: row.ownerName as string,
      sellerGhii: row.sellerGhii as string,
      title: row.title as string,
      description: row.description as string,
      category: row.category as ListingRecord['category'],
      priceMorsels: row.priceMorsels as number,
      status: row.status as ListingRecord['status'],
      memoryKey: row.memoryKey as string,
      flagCount: row.flagCount as number,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.condition) record.condition = row.condition as ListingRecord['condition'];
    if (row.availability) record.availability = row.availability as ListingRecord['availability'];
    if (row.location) record.location = JSON.parse(row.location as string);
    if (row.tags) record.tags = JSON.parse(row.tags as string);
    if (row.images) record.images = JSON.parse(row.images as string);
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    return record;
  },

  deserializePurchase(this: SqliteStorage, row: Record<string, unknown>): PurchaseRecord {
    const record: PurchaseRecord = {
      id: row.id as string,
      listingId: row.listingId as string,
      buyerOwner: row.buyerOwner as string,
      sellerOwner: row.sellerOwner as string,
      priceMorsels: row.priceMorsels as number,
      transactionFeeMorsels: row.transactionFeeMorsels as number,
      totalCostMorsels: row.totalCostMorsels as number,
      status: row.status as PurchaseRecord['status'],
      trackingCode: row.trackingCode as string,
      createdAt: row.createdAt as string,
    };
    if (row.rating) record.rating = JSON.parse(row.rating as string);
    if (row.completedAt) record.completedAt = row.completedAt as string;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Push Subscriptions ──
  // ══════════════════════════════════════════════════════════

  async createPushSubscription(this: SqliteStorage, record: PushSubscriptionRecord): Promise<PushSubscriptionRecord> {
    this.db.prepare(
      `INSERT OR REPLACE INTO push_subscriptions (ownerName, endpoint, keys, createdAt, lastUsedAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      record.ownerName, record.endpoint,
      JSON.stringify(record.keys), record.createdAt, record.lastUsedAt,
    );
    return record;
  },

  async getPushSubscription(this: SqliteStorage, ownerName: string): Promise<PushSubscriptionRecord | null> {
    const row = this.db.prepare('SELECT * FROM push_subscriptions WHERE ownerName = ?').get(ownerName) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      ownerName: row.ownerName as string,
      endpoint: row.endpoint as string,
      keys: JSON.parse(row.keys as string),
      createdAt: row.createdAt as string,
      lastUsedAt: row.lastUsedAt as string,
    };
  },

  async deletePushSubscription(this: SqliteStorage, ownerName: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM push_subscriptions WHERE ownerName = ?').run(ownerName);
    return result.changes > 0;
  },

  async listPushSubscriptions(this: SqliteStorage): Promise<PushSubscriptionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM push_subscriptions').all() as Record<string, unknown>[];
    return rows.map(r => ({
      ownerName: r.ownerName as string,
      endpoint: r.endpoint as string,
      keys: JSON.parse(r.keys as string),
      createdAt: r.createdAt as string,
      lastUsedAt: r.lastUsedAt as string,
    }));
  },

  // ══════════════════════════════════════════════════════════
  // ── Trusted Issuers ──
  // ══════════════════════════════════════════════════════════

  async createTrustedIssuer(this: SqliteStorage, record: TrustedIssuerRecord): Promise<TrustedIssuerRecord> {
    this.db.prepare(
      `INSERT INTO trusted_issuers (id, name, url, publicKey, type, trusted, addedBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.name, record.url, record.publicKey,
      record.type, record.trusted ? 1 : 0, record.addedBy, record.createdAt,
    );
    return record;
  },

  async getTrustedIssuer(this: SqliteStorage, id: string): Promise<TrustedIssuerRecord | null> {
    const row = this.db.prepare('SELECT * FROM trusted_issuers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeTrustedIssuer(row) : null;
  },

  async getTrustedIssuerByUrl(this: SqliteStorage, url: string): Promise<TrustedIssuerRecord | null> {
    const row = this.db.prepare('SELECT * FROM trusted_issuers WHERE url = ?').get(url) as Record<string, unknown> | undefined;
    return row ? this.deserializeTrustedIssuer(row) : null;
  },

  async listTrustedIssuers(this: SqliteStorage, opts?: { type?: string }): Promise<TrustedIssuerRecord[]> {
    let sql = 'SELECT * FROM trusted_issuers';
    const params: unknown[] = [];
    if (opts?.type) { sql += ' WHERE type = ?'; params.push(opts.type); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeTrustedIssuer(r));
  },

  async deleteTrustedIssuer(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM trusted_issuers WHERE id = ?').run(id);
    return result.changes > 0;
  },

  deserializeTrustedIssuer(this: SqliteStorage, row: Record<string, unknown>): TrustedIssuerRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      url: row.url as string,
      publicKey: row.publicKey as string,
      type: row.type as TrustedIssuerRecord['type'],
      trusted: (row.trusted as number) === 1,
      addedBy: row.addedBy as string,
      createdAt: row.createdAt as string,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Verification Nonces ──
  // ══════════════════════════════════════════════════════════

  async createVerificationNonce(this: SqliteStorage, record: VerificationNonceRecord): Promise<VerificationNonceRecord> {
    this.db.prepare(
      'INSERT INTO verification_nonces (id, owner, type, state, nonce, redirectUri, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(record.id, record.owner, record.type, record.state, record.nonce, record.redirectUri ?? '', record.createdAt, record.expiresAt);
    return record;
  },

  async getVerificationNonce(this: SqliteStorage, state: string): Promise<VerificationNonceRecord | null> {
    const row = this.db.prepare('SELECT * FROM verification_nonces WHERE state = ?').get(state) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      owner: row.owner as string,
      type: row.type as 'eudiw' | 'ftn' | 'google_login',
      state: row.state as string,
      nonce: row.nonce as string,
      redirectUri: row.redirectUri as string,
      createdAt: row.createdAt as string,
      expiresAt: row.expiresAt as string,
    };
  },

  async deleteVerificationNonce(this: SqliteStorage, state: string): Promise<void> {
    this.db.prepare('DELETE FROM verification_nonces WHERE state = ?').run(state);
  },

  async cleanExpiredNonces(this: SqliteStorage): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare('DELETE FROM verification_nonces WHERE expiresAt < ?').run(now);
    return result.changes;
  },

  // ══════════════════════════════════════════════════════════
  // ── Genesis Peers ──
  // ══════════════════════════════════════════════════════════

  async createGenesisPeer(this: SqliteStorage, record: GenesisPeerRecord): Promise<GenesisPeerRecord> {
    this.db.prepare(
      `INSERT INTO genesis_peers (id, genesisNodeId, genesisUrl, publicKey, status, lastSyncAt, catalogueHash, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.genesisNodeId, record.genesisUrl, record.publicKey,
      record.status, record.lastSyncAt, record.catalogueHash,
      record.createdAt, record.updatedAt,
    );
    return record;
  },

  async getGenesisPeer(this: SqliteStorage, id: string): Promise<GenesisPeerRecord | null> {
    const row = this.db.prepare('SELECT * FROM genesis_peers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeGenesisPeer(row) : null;
  },

  async getGenesisPeerByNodeId(this: SqliteStorage, nodeId: string): Promise<GenesisPeerRecord | null> {
    const row = this.db.prepare('SELECT * FROM genesis_peers WHERE genesisNodeId = ?').get(nodeId) as Record<string, unknown> | undefined;
    return row ? this.deserializeGenesisPeer(row) : null;
  },

  async listGenesisPeers(this: SqliteStorage, opts?: { status?: string }): Promise<GenesisPeerRecord[]> {
    let sql = 'SELECT * FROM genesis_peers';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' WHERE status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeGenesisPeer(r));
  },

  async updateGenesisPeer(this: SqliteStorage, id: string, updates: Partial<GenesisPeerRecord>): Promise<GenesisPeerRecord | null> {
    const existing = await this.getGenesisPeer(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE genesis_peers SET genesisNodeId = ?, genesisUrl = ?, publicKey = ?, status = ?,
       lastSyncAt = ?, catalogueHash = ?, createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.genesisNodeId, updated.genesisUrl, updated.publicKey, updated.status,
      updated.lastSyncAt, updated.catalogueHash, updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  },

  async deleteGenesisPeer(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM genesis_peers WHERE id = ?').run(id);
    return result.changes > 0;
  },

  deserializeGenesisPeer(this: SqliteStorage, row: Record<string, unknown>): GenesisPeerRecord {
    return {
      id: row.id as string,
      genesisNodeId: row.genesisNodeId as string,
      genesisUrl: row.genesisUrl as string,
      publicKey: row.publicKey as string,
      status: row.status as GenesisPeerRecord['status'],
      lastSyncAt: row.lastSyncAt as string,
      catalogueHash: row.catalogueHash as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Organism Reputation ──
  // ══════════════════════════════════════════════════════════

  async setOrganismReputation(this: SqliteStorage, record: OrganismReputationRecord): Promise<OrganismReputationRecord> {
    this.db.prepare(
      `INSERT OR REPLACE INTO organism_reputations (organismId, score, breakdown, calculatedAt)
       VALUES (?, ?, ?, ?)`
    ).run(
      record.organismId, record.score,
      JSON.stringify(record.breakdown), record.calculatedAt,
    );
    return record;
  },

  async getOrganismReputation(this: SqliteStorage, organismId: string): Promise<OrganismReputationRecord | null> {
    const row = this.db.prepare('SELECT * FROM organism_reputations WHERE organismId = ?').get(organismId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      organismId: row.organismId as string,
      score: row.score as number,
      breakdown: JSON.parse(row.breakdown as string),
      calculatedAt: row.calculatedAt as string,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Realtime Rooms ──
  // ══════════════════════════════════════════════════════════

  async createRealtimeRoom(this: SqliteStorage, room: RealtimeRoomRecord): Promise<RealtimeRoomRecord> {
    this.db.prepare(
      `INSERT INTO realtime_rooms (id, appType, name, createdBy, maxPeers, isPublic, tags, peerCount, createdAt, lastActivityAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      room.id, room.appType, room.name, room.createdBy,
      room.maxPeers, room.isPublic ? 1 : 0,
      JSON.stringify(room.tags), room.peerCount,
      room.createdAt, room.lastActivityAt,
    );
    return room;
  },

  async getRealtimeRoom(this: SqliteStorage, id: string): Promise<RealtimeRoomRecord | null> {
    const row = this.db.prepare('SELECT * FROM realtime_rooms WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeRealtimeRoom(row) : null;
  },

  async listRealtimeRooms(this: SqliteStorage, filter?: { appType?: string; isPublic?: boolean }): Promise<RealtimeRoomRecord[]> {
    let sql = 'SELECT * FROM realtime_rooms WHERE 1=1';
    const params: unknown[] = [];
    if (filter?.appType) { sql += ' AND appType = ?'; params.push(filter.appType); }
    if (filter?.isPublic !== undefined) { sql += ' AND isPublic = ?'; params.push(filter.isPublic ? 1 : 0); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeRealtimeRoom(r));
  },

  async updateRealtimeRoom(this: SqliteStorage, id: string, updates: Partial<RealtimeRoomRecord>): Promise<RealtimeRoomRecord | null> {
    const existing = await this.getRealtimeRoom(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE realtime_rooms SET appType = ?, name = ?, createdBy = ?, maxPeers = ?,
       isPublic = ?, tags = ?, peerCount = ?, createdAt = ?, lastActivityAt = ? WHERE id = ?`
    ).run(
      updated.appType, updated.name, updated.createdBy, updated.maxPeers,
      updated.isPublic ? 1 : 0, JSON.stringify(updated.tags),
      updated.peerCount, updated.createdAt, updated.lastActivityAt, id,
    );
    return updated;
  },

  async deleteRealtimeRoom(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM realtime_rooms WHERE id = ?').run(id);
    return result.changes > 0;
  },

  deserializeRealtimeRoom(this: SqliteStorage, row: Record<string, unknown>): RealtimeRoomRecord {
    return {
      id: row.id as string,
      appType: row.appType as string,
      name: row.name as string,
      createdBy: row.createdBy as string,
      maxPeers: row.maxPeers as number,
      isPublic: (row.isPublic as number) === 1,
      tags: JSON.parse(row.tags as string) as string[],
      peerCount: row.peerCount as number,
      createdAt: row.createdAt as string,
      lastActivityAt: row.lastActivityAt as string,
    };
  },

  // ══════════════════════════════════════════════════════════
};
