/**
 * @file invitation-lookup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Finding the pending-invitation row for one owner, whatever form the row was written
 *   in. Memberships are keyed by the BARE owner name — organisms.ts, consent.ts and every access
 *   gate look one up that way — but rows written before that was settled carry the full GHII
 *   (`kkk@node`). Such a row is LISTED as a pending invitation, because the listing scans by
 *   organism + status rather than by name, while withdraw and edit looked it up by exact name and
 *   missed it. The owner therefore saw an invitation they were told did not exist, on a production
 *   organism, with no way to take it back.
 *
 *   The lookup is the one place that knows about both forms. Everything downstream keeps working on
 *   the bare owner name, which is why the notification target is derived here rather than by pasting
 *   a node id onto whatever the row happened to store.
 * @structure
 *   - membershipOwner() — the bare owner behind `alice`, `alice@node` or `agent#alice@node`
 *   - findPendingInvitation() — the invited row for an owner, exact match first, then a scan
 * @usage
 *   const membership = await findPendingInvitation(storage, organism.id, invitee);
 * @version-history
 *   v1.0.0 -- 2026-08-25 -- Extracted so cancel and update share one tolerant lookup (a listed
 *     invitation on the VIP organism could not be withdrawn: it was stored as `kkk@node`).
 */
import type { Storage, OrganismMembershipRecord } from '../storage/interface.js';

/** The bare owner behind a stored membership key: `alice`, `alice@node`, `agent#alice@node`. */
export function membershipOwner(ghii: string): string {
  return (ghii.includes('#') ? ghii.split('#')[1] : ghii).split('@')[0];
}

/**
 * The pending invitation for `invitee` in this organism, or null.
 *
 * Exact match first, which is what every current write produces and the only row a healthy node
 * has. The scan is the fallback for a legacy row keyed by the full GHII; it matches on the owner
 * behind the stored key, so it finds that row and nothing belonging to anybody else. An ACTIVE
 * membership is not an invitation and never answers here.
 */
export async function findPendingInvitation(
  storage: Storage,
  organismId: string,
  invitee: string,
): Promise<OrganismMembershipRecord | null> {
  const direct = await storage.getMembership(organismId, invitee);
  if (direct?.status === 'invited') return direct;
  const invited = await storage.listMembers(organismId, { status: 'invited' });
  return invited.find(m => membershipOwner(m.ghii) === invitee) ?? null;
}
