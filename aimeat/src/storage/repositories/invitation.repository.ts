/**
 * @file invitation.repository.ts
 * @description Storage contract for email invitations to people who are NOT yet in the system.
 *   A creator/admin invites an external email into an organism (+ selected workspaces with a
 *   role). The invite carries a single-use, time-limited token in an emailed link; on accept the
 *   recipient registers a brand-new account and is joined to the organism + workspaces. Only the
 *   SHA-256 hash of the raw token is ever stored; the raw token lives only in the emailed URL.
 * @structure InvitationWorkspaceGrant + InvitationRecord shapes; InvitationRepository interface
 *   (create / get-by-hash / get-by-id / list-by-organism / count-by-inviter / update / cleanup-expired).
 * @usage Implemented by each storage provider (SQLite, MongoDB) and composed into the Storage
 *   interface. Consumed by src/routes/organisms.ts (invite/accept) and the invitation-expiry job.
 * @version-history
 *   v1.0.0 — 2026-07-04 — Initial (email invitations for unregistered users).
 *   v1.1.0 — 2026-07-05 — Add provisioned-code invitations: type ('link'|'code'), provisionedOwner, countInvitationsByInviter (per-inviter quota).
 *   v1.2.0 — 2026-07-07 — Add getCodeInvitationByProvisionedOwner (first-login credential issuance, TARGET-011).
 *   v1.3.0 — 2026-07-18 — Add returnUrl: an allowlisted app/node URL the inviter can pin so a link
 *     invitee lands back in the inviting app (e.g. the Experience Center) already signed in after accept.
 */

/** One selected workspace + the role the invitee should receive there. */
export interface InvitationWorkspaceGrant {
  ws: string;
  role: 'viewer' | 'contributor';
}

export interface InvitationRecord {
  id: string; // public id for list / cancel
  tokenHash: string; // SHA-256 of the raw token (lookup key) — raw token is never stored
  organismId: string; // the organism the invitee joins
  orgRole: 'member' | 'admin'; // organism role granted on accept
  type: 'link' | 'code'; // 'link' = magic-link self-register (default); 'code' = account provisioned at mint, code is its password
  workspaces: InvitationWorkspaceGrant[]; // per-workspace roles to grant on accept
  email: string; // invited address (plaintext — shown to inviter, pre-filled + locked on accept)
  emailHash: string; // SHA-256 of the lowercased email — existing-user detection + lookup
  invitedBy: string; // bare owner name of the inviter (creator/admin)
  provisionedOwner: string | null; // (code only) bare name of the account this invite created — deleted on cancel/expiry
  message: string | null; // optional personal note included in the email
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  createdAt: string; // ISO
  expiresAt: string; // ISO — hard expiry (lazy-checked at read/accept + swept by a core job)
  acceptedAt: string | null;
  acceptedBy: string | null; // bare owner name of the account that accepted (code: set when the provisioned account first logs in)
  returnUrl: string | null; // (link only) allowlisted app/node URL to land the accepter on after joining — set at mint, re-validated at redirect (open-redirect guard). null = default profile redirect.
}

export interface InvitationRepository {
  /** Persist a new email invitation (token stored as hash only). */
  createInvitation(rec: InvitationRecord): Promise<void>;
  /** Look up an invitation by its token's SHA-256 hash (used on read/accept). */
  getInvitationByHash(tokenHash: string): Promise<InvitationRecord | null>;
  /** Look up an invitation by its public id (used on cancel). */
  getInvitation(id: string): Promise<InvitationRecord | null>;
  /** List an organism's invitations, optionally filtered by status. Never returns the token. */
  listInvitationsByOrganism(organismId: string, opts?: { status?: InvitationRecord['status'] }): Promise<InvitationRecord[]>;
  /** Count invitations by inviter for quota enforcement (per-inviter cap on code keys). */
  countInvitationsByInviter(invitedBy: string, opts?: { organismId?: string; type?: InvitationRecord['type']; statuses?: InvitationRecord['status'][] }): Promise<number>;
  /** Find the (single) code invitation that provisioned this owner account, if any. Used on the
   *  provisioned account's first login to issue durable login credentials + flip the invite to
   *  accepted. Returns null for accounts that were not created by a code key. */
  getCodeInvitationByProvisionedOwner(owner: string): Promise<InvitationRecord | null>;
  /** Partial update (status flip on accept/cancel, acceptedAt/acceptedBy). */
  updateInvitation(id: string, updates: Partial<InvitationRecord>): Promise<InvitationRecord | null>;
  /** Sweep: flip still-pending invitations whose expiry has passed to `expired`. Returns count. */
  cleanupExpiredInvitations(nowIso: string): Promise<number>;
}
