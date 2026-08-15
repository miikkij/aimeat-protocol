/**
 * @file organism-roles.js
 * @description Who holds an organism and who may act in it: owners (add, remove, hand over),
 *   admins, member removal and bans. Extracted from organisms.js when that file passed 800 lines;
 *   the calls are unchanged and organisms.js re-exports every one of them.
 *
 *   Ownership is PLURAL. addOwner is additive — the caller keeps everything — and the last owner
 *   cannot be removed, because an organism with no owner is the one state nobody inside it can
 *   repair. transferOwnership is the two steps in one call, kept for what already used it.
 * @structure removeMember · unbanMember · transferOwnership · addOwner · removeOwner · addAdmin · removeAdmin
 * @usage import { addOwner } from '/js/services/organism-roles.js';
 * @version-history
 *   v1.0.0 — 2026-08-15 — Pure extraction from organisms.js, plus addOwner/removeOwner.
 */
import { apiPost, apiDelete } from '/js/api.js';

/** Remove (revoke) a member's organism access. Creator/admin only. Pass ban=true to block re-join. */
export async function removeMember(id, memberGhii, ban = false) {
  const suffix = ban ? '?ban=1' : '';
  return apiDelete(`/v1/organisms/${encodeURIComponent(id)}/members/${encodeURIComponent(memberGhii)}${suffix}`);
}

/** Lift a ban on a previously-blocked owner. Creator/admin only. */
export async function unbanMember(id, memberGhii) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/members/${encodeURIComponent(memberGhii)}/unban`, {});
}

/** Transfer ownership to an existing active member. Creator only. */
export async function transferOwnership(id, toGhii) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/transfer`, { to: toGhii });
}

/** Add a co-owner. Additive: the caller keeps everything they had. */
export async function addOwner(id, ghii) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/owners`, { ghii });
}

/** Take an owner off the organism; they stay as an admin. The last owner cannot be removed. */
export async function removeOwner(id, ghii) {
  return apiDelete(`/v1/organisms/${encodeURIComponent(id)}/owners/${encodeURIComponent(ghii)}`);
}

/** Add admin. */
export async function addAdmin(id, targetGhii) {
  return apiPost(`/v1/organisms/${encodeURIComponent(id)}/admins`, { target_ghii: targetGhii });
}

/** Remove admin. */
export async function removeAdmin(id, ghii) {
  return apiDelete(`/v1/organisms/${encodeURIComponent(id)}/admins/${encodeURIComponent(ghii)}`);
}
