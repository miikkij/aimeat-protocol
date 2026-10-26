/**
 * @file src/services/capability-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who reaches one capability by its id, and which visibility words a capability may carry.
 *
 *   WHY. GET /v1/capabilities/:id and POST /v1/capabilities/:id/invoke hid a capability from others
 *   only when its visibility was 'private', and the MCP tool aimeat_capabilities_get asked nothing at
 *   all. A draft, a capability waiting for the operator's review and a rejected one were served to
 *   every caller who had the id, although the list shows them to nobody but their owner. And a write
 *   stored any visibility word it was given, which the read and the list then read in two different
 *   ways (secaudit2026oct22; developer decision 2026-10-26).
 *
 *   THE RULE. The owner's side (the owner, the owner's agents and the apps acting for the owner, all
 *   one owner by isSameOwner) reaches every capability of the owner. Everyone else reaches a
 *   capability only when its visibility is a word that opens it ('owner' or 'public') AND its status
 *   is one that was published ('active', 'deprecated', 'disabled'). Everything else, an unknown word
 *   or an unknown status included, is closed. The operator passes the doors on top of this, each door
 *   with its own operator check. A closed capability answers the same 404 as a missing id.
 *
 *   The 'owner' word stays open on these two doors, as it was: an active 'owner' capability is the
 *   one a plain owner may offer to other signed-in accounts on a self_only node. The list hides it
 *   from others (storage filter publicOrOwner), which is unchanged.
 * @structure CAPABILITY_VISIBILITIES · capabilityVisibilityRefusal() · isCapabilityOwnersSide() ·
 *   capabilityOpenToOthers() · capabilityHiddenFrom()
 * @usage
 *   if (capabilityHiddenFrom(cap, identity) && !operatorPasses) return notFound();
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (secaudit2026oct22; developer decision 2026-10-26).
 */
import type { CapabilityRecord } from '../storage/interface.js';
import { isSameOwner, parseGaiiLoose } from '../utils/gaii.js';

/** Every visibility word the code knows for a capability (storage/types/capabilities.ts). */
export const CAPABILITY_VISIBILITIES: readonly CapabilityRecord['visibility'][] = ['private', 'owner', 'public'];

/** The visibility words that open a published capability to callers outside the owner's side. */
const OPEN_VISIBILITIES: ReadonlySet<string> = new Set(['owner', 'public']);

/**
 * The statuses a capability has once its owner published it. 'deprecated' and 'disabled' stay
 * reachable so a caller learns that it was retired (invoke answers 410 CAPABILITY_GONE for disabled).
 * 'draft', 'pending_review' and 'rejected' were never published.
 */
const PUBLISHED_STATUSES: ReadonlySet<string> = new Set(['active', 'deprecated', 'disabled']);

/** Null when `word` is a visibility word the node knows, else the sentence a 400 answers with. */
export function capabilityVisibilityRefusal(word: unknown): string | null {
    if (typeof word === 'string' && (CAPABILITY_VISIBILITIES as readonly string[]).includes(word)) return null;
    return `The visibility "${String(word)}" is not one this node knows. Use one of: ${CAPABILITY_VISIBILITIES.join(', ')}.`;
}

/**
 * True when `identity` (resolveIdentity's answer, or an MCP session's GAII) is the capability's
 * owner or acts for the same owner on the same node. An identity without an owner part is never
 * on anyone's side, so two unparsable strings cannot match each other.
 */
export function isCapabilityOwnersSide(cap: Pick<CapabilityRecord, 'ownerGhii'>, identity: string | null | undefined): boolean {
    if (!identity) return false;
    if (identity === cap.ownerGhii) return true;
    return !!parseGaiiLoose(identity).owner && isSameOwner(identity, cap.ownerGhii);
}

/** True when a caller outside the owner's side may reach the capability by its id. */
export function capabilityOpenToOthers(cap: Pick<CapabilityRecord, 'visibility' | 'status'>): boolean {
    return OPEN_VISIBILITIES.has(cap.visibility) && PUBLISHED_STATUSES.has(cap.status);
}

/** True when the capability is closed to `identity`, before any operator check of the door. */
export function capabilityHiddenFrom(cap: Pick<CapabilityRecord, 'ownerGhii' | 'visibility' | 'status'>, identity: string | null | undefined): boolean {
    return !capabilityOpenToOthers(cap) && !isCapabilityOwnersSide(cap, identity);
}
