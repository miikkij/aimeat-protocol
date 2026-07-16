/**
 * @file src/storage/repositories/organism.repository.ts
 * @description Storage repository interface for organisms and their membership graph:
 *   organism CRUD/listing, memberships, join requests, reputation, and the Phase 4
 *   pending-approval (gate) primitive. Each backend implements this contract.
 *
 * @structure
 *   - OrganismRepository: organism + membership + join-request + reputation operations
 *   - PendingApproval methods: create/get/list/update plus listOverduePendingApprovals
 *
 * @version-history
 *   v1.1.0 — 2026-07-16 — Add listPendingApprovalsForOrgs batch primitive (Phase 3 fan-out→IN).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { ArchiveFilter, OrganismRecord, OrganismMembershipRecord, JoinRequestRecord, OrganismReputationRecord, PendingApprovalRecord } from '../interface.js';

export interface OrganismRepository {
  createOrganism(record: OrganismRecord): Promise<OrganismRecord>;
  getOrganism(id: string): Promise<OrganismRecord | null>;
  listOrganisms(opts?: { type?: string; city?: string; interest?: string; visibility?: string; member?: string; page?: number; perPage?: number; archived?: ArchiveFilter }): Promise<OrganismRecord[]>;
  updateOrganism(id: string, updates: Partial<OrganismRecord>): Promise<OrganismRecord | null>;
  deleteOrganism(id: string): Promise<boolean>;
  createMembership(record: OrganismMembershipRecord): Promise<OrganismMembershipRecord>;
  getMembership(organismId: string, ghii: string): Promise<OrganismMembershipRecord | null>;
  listMembers(organismId: string, opts?: { role?: string; status?: string }): Promise<OrganismMembershipRecord[]>;
  listMembershipsByGhii(ghii: string): Promise<OrganismMembershipRecord[]>;
  updateMembership(id: string, updates: Partial<OrganismMembershipRecord>): Promise<OrganismMembershipRecord | null>;
  deleteMembership(id: string): Promise<boolean>;
  createJoinRequest(record: JoinRequestRecord): Promise<JoinRequestRecord>;
  getJoinRequest(id: string): Promise<JoinRequestRecord | null>;
  listJoinRequests(organismId: string, opts?: { status?: string }): Promise<JoinRequestRecord[]>;
  updateJoinRequest(id: string, updates: Partial<JoinRequestRecord>): Promise<JoinRequestRecord | null>;
  setOrganismReputation(record: OrganismReputationRecord): Promise<OrganismReputationRecord>;
  getOrganismReputation(organismId: string): Promise<OrganismReputationRecord | null>;
  // Phase 4 — Gate primitive (PendingApproval)
  createPendingApproval(record: PendingApprovalRecord): Promise<PendingApprovalRecord>;
  getPendingApproval(id: string): Promise<PendingApprovalRecord | null>;
  listPendingApprovals(organismId: string, opts?: { status?: string }): Promise<PendingApprovalRecord[]>;
  /**
   * BULK PRIMITIVE (Phase 3) — pending approvals for MANY organisms in ONE `organismId IN (…)` query,
   * grouped by organism. Backs the "Waiting for you" home aggregate, which called listPendingApprovals
   * once per member organism. Keyed by organismId (an org with none is absent). Optional — a backend
   * without it falls back to a per-organism loop.
   */
  listPendingApprovalsForOrgs?(organismIds: string[], opts?: { status?: string }): Promise<Record<string, PendingApprovalRecord[]>>;
  updatePendingApproval(id: string, updates: Partial<PendingApprovalRecord>): Promise<PendingApprovalRecord | null>;
  listOverduePendingApprovals(nowIso: string): Promise<PendingApprovalRecord[]>;
}
