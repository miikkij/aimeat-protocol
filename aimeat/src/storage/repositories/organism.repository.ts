import type { OrganismRecord, OrganismMembershipRecord, JoinRequestRecord, OrganismReputationRecord, PendingApprovalRecord } from '../interface.js';

export interface OrganismRepository {
  createOrganism(record: OrganismRecord): Promise<OrganismRecord>;
  getOrganism(id: string): Promise<OrganismRecord | null>;
  listOrganisms(opts?: { type?: string; city?: string; interest?: string; visibility?: string; member?: string; page?: number; perPage?: number }): Promise<OrganismRecord[]>;
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
  updatePendingApproval(id: string, updates: Partial<PendingApprovalRecord>): Promise<PendingApprovalRecord | null>;
  listOverduePendingApprovals(nowIso: string): Promise<PendingApprovalRecord[]>;
}
