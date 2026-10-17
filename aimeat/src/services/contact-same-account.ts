/**
 * @file src/services/contact-same-account.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Has the recipient already accepted contact from the sender's ACCOUNT? A person and their
 *   agents are one account: the owner's agent may write first, and when the owner then answers in the
 *   agent's conversation, their message would land in the recipient's contact requests, and the whole
 *   thread would leave the recipient's list until they accepted the owner as well. Jouni ruled that a
 *   person who accepted one identity of an account has accepted contact from that account (2026-10-17,
 *   decision-viestin-puoli-ja-merkint-kertovat-kuka-sen-kirjoitti-ja-omis).
 *
 *   An accepted AGENT of the account counts; a blocked contact never widens anything. The comparison is
 *   the owner AND the node (isSameOwner), so a namesake on another node is a different account.
 * @structure acceptedSameAccount(storage, mailboxGhii, senderGhii)
 * @usage if (await acceptedSameAccount(storage, deliveryGhii, senderGhii)) state = 'accepted';
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (wish-agentin-omistajan-nimiss-l-hett-m-viesti-n-ytt-mik-agentti-s).
 */
import type { Storage } from '../storage/interface.js';
import { isSameOwner, parseGaiiLoose } from '../utils/gaii.js';

/**
 * True when `mailboxGhii` has accepted an AGENT of the account `senderGhii` belongs to. Only an accepted
 * agent counts: a person's own contact with the owner is often accepted by the node itself (the
 * operator's welcome message is auto-accepted for every new account), and counting it would let every
 * agent of that owner past everybody's request queue.
 */
export async function acceptedSameAccount(storage: Storage, mailboxGhii: string, senderGhii: string): Promise<boolean> {
  const accepted = await storage.listContacts(mailboxGhii, { state: 'accepted' });
  return accepted.some(c => c.contactId !== senderGhii && !c.contactId.startsWith('eco:')
    && !!parseGaiiLoose(c.contactId).agent && isSameOwner(c.contactId, senderGhii));
}
