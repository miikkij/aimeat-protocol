/**
 * @file src/services/contact/shared-organism.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Do the recipient and the sender's person share an organism that nobody joins on
 *   their own? Asked by the first-contact gate of a direct message (services/message/send.ts): a
 *   message from such a co-member is delivered to the inbox, not to the contact requests.
 *
 *   WHY. On 2026-11-13 a member of a shared organism asked another member a question about the
 *   organism's own work by direct message. It sat in the recipient's contact requests for two days,
 *   unseen, although both had been let into the same organism by its owners. Membership there
 *   already is the introduction the request gate asks for.
 *
 *   WHICH ORGANISMS COUNT. Active membership of both, in an organism that is not archived and whose
 *   join policy is `approval_required` or `invite_only`: somebody let each of them in. An `open`
 *   organism does not count, because anybody joins it, and counting it would let anyone past every
 *   member's request gate by joining first. When the sender is an agent, the organism must also
 *   admit that agent (agentAccess `listed` admits only its list): an agent the organism keeps out
 *   is no co-member's introduction. An ecosystem app is never a co-member here, and an identity of
 *   another node has no local membership, so neither passes. A block still wins: the gate asks this
 *   only when there is no contact row or the row is pending.
 * @structure shareClosedOrganism(storage, recipientGhii, senderGhii)
 * @usage if (await shareClosedOrganism(storage, deliveryGhii, senderGhii)) state = 'accepted';
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */
import type { Storage } from '../../storage/interface.js';
import { isGEAI, localAccountName, ownerGhiiOf } from '../../utils/gaii.js';
import { agentBarred } from '../organism/agent-access.js';

/** Active memberships of one account, by organism id. Memberships are keyed by the bare account name. */
async function activeOrganismIds(storage: Storage, account: string): Promise<Set<string>> {
  const rows = await storage.listMembershipsByGhii(account);
  return new Set(rows.filter(m => m.status === 'active').map(m => m.organismId));
}

/**
 * True when the person `recipientGhii` and the person `senderGhii` acts for are both active members
 * of one organism that admits members only by invitation or approval, and that admits the sender
 * when the sender is an agent. False for the same account (the gate decides that case itself).
 */
export async function shareClosedOrganism(storage: Storage, recipientGhii: string, senderGhii: string): Promise<boolean> {
  if (typeof senderGhii !== 'string' || !senderGhii || isGEAI(senderGhii)) return false;
  const recipient = localAccountName(recipientGhii);
  const sender = localAccountName(ownerGhiiOf(senderGhii));
  // An identity of another node keeps its node part, so it never names a local membership.
  if (!recipient || !sender || recipient === sender || recipient.includes('@') || sender.includes('@')) return false;
  const [theirs, mine] = await Promise.all([activeOrganismIds(storage, sender), activeOrganismIds(storage, recipient)]);
  for (const id of theirs) {
    if (!mine.has(id)) continue;
    const organism = await storage.getOrganism(id);
    if (!organism || organism.archived || organism.joinPolicy === 'open') continue;
    if (agentBarred(organism, senderGhii)) continue;
    return true;
  }
  return false;
}
