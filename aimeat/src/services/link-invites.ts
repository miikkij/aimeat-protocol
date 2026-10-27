/**
 * @file link-invites.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One-time invitations that admit a node at a named tier.
 *
 *   Peering is an operator approving a stranger who knocked. That is the right shape for a stranger
 *   and the wrong one for a node you are provisioning yourself: the provider stands up a managed
 *   instance, hands it over, and the customer's operator would otherwise have to approve a request
 *   from the company they just bought it from, on a screen they have not been shown yet.
 *
 *   An invite closes that. The provider mints one, provisioning presents it once at introduce time,
 *   and the link exists before the customer ever logs in — at the tier the invite names and no other.
 *
 *   WHY THE TIER LIVES ON THE INVITE. Never in the request body. Taking a tier from what the caller
 *   sent is the F1 mistake written up in federation-peer/lifecycle.ts: an unauthenticated door that
 *   believes a claim about its own trust level is not a door. The invite is a secret this node minted
 *   and stored, so what it says is this node's own earlier decision, quoted back.
 *
 *   The token is HASHED at rest. It is a bearer secret: whoever holds it gets one link, so a stored
 *   copy is a spare key. Its own id is not derived from it, so listing invites reveals nothing that
 *   could be used to consume one.
 *
 *   A used, expired or unknown token is not an error. Introduce falls through to the ordinary pending
 *   path, so a leaked token is worth exactly one link at one tier, once, and a mistyped one is a
 *   peering request an operator can look at.
 * @structure
 *   - mintLinkInvite() — create one, return the token ONCE
 *   - listLinkInvites() — what exists, without the tokens
 *   - consumeLinkInvite() — claim a token, or refuse; single-use
 *   - revokeLinkInvite() — delete one by id
 * @usage
 *   const invite = await mintLinkInvite(storage, { tier: 'contact', createdBy, ttlHours: 72 });
 *   // ... later, on introduce:
 *   const claimed = await consumeLinkInvite(storage, token, nodeId);
 * @version-history
 *   2026-10-27 — An invite may name the node it is for (`nodeId`). consumeLinkInvite leaves such an
 *     invite unused for any other node id ('other-node'), and leaves an invite that names no node
 *     unused when the node id is held by a peer under another key ('held'): only an invite naming the
 *     node may replace that peer (secaudit2026oct26).
 *   2026-10-18 — consumeLinkInvite writes the consumed invite on the version it read (setMemoryIfVersion).
 *   v1.0.0 — 2026-08-23 — Initial, for the contact tier.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { PeerTier } from './federation-tiers.js';
import { coerceTier } from './federation-tiers.js';
import { logger } from '../utils/logger.js';

/** The system identity these records live under. Not an owner: no person holds them. */
export const LINK_INVITE_GAII = '__link_invites__';
const KEY_PREFIX = 'link-invite.';

/** How long an unused invite stands by default. Long enough to provision a node, short enough that a
 *  forgotten one stops being a key. */
export const DEFAULT_INVITE_TTL_HOURS = 72;

export interface LinkInviteRecord {
  id: string;
  tier: PeerTier;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
  consumedByNodeId?: string;
  /** Free-text note from the operator: which customer this was minted for. */
  label?: string;
  /**
   * The node this invite is for, when the operator named one. Only that node id may use it, and only
   * such an invite may replace a peer held under that id with another key (secaudit2026oct26).
   */
  nodeId?: string;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const keyFor = (token: string): string => `${KEY_PREFIX}${hashToken(token)}`;

export interface MintInviteInput {
  tier: PeerTier;
  createdBy: string;
  ttlHours?: number;
  label?: string;
  nodeId?: string;
}

/**
 * Mint one invite. The token is returned HERE and nowhere else, ever: only its hash is stored, so a
 * lost token is re-minted rather than looked up.
 */
export async function mintLinkInvite(
  storage: Storage,
  input: MintInviteInput,
): Promise<{ token: string; invite: LinkInviteRecord }> {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const ttl = Math.max(1, input.ttlHours ?? DEFAULT_INVITE_TTL_HOURS);
  const invite: LinkInviteRecord = {
    id: randomUUID(),
    tier: input.tier,
    createdBy: input.createdBy,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 3600_000).toISOString(),
    label: input.label,
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
  };

  await storage.setMemory({
    key: keyFor(token),
    ownerGaii: LINK_INVITE_GAII,
    value: invite as unknown as Record<string, unknown>,
    visibility: 'private',
    tags: ['federation', 'link-invite'],
    // The record outlives the invite on purpose: a consumed one is the audit trail of who was admitted
    // and at what tier, which is worth more than the row it costs.
    ttlHours: null,
    version: 1,
    createdAt: invite.createdAt,
    updatedAt: invite.createdAt,
  });

  return { token, invite };
}

/** Every invite this node has minted, newest first. Never includes a token. */
export async function listLinkInvites(storage: Storage): Promise<LinkInviteRecord[]> {
  const records = await storage.listMemory(LINK_INVITE_GAII, { prefix: KEY_PREFIX });
  return records
    .map(r => r.value as unknown as LinkInviteRecord)
    .filter(v => v && typeof v === 'object' && v.id)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export type ConsumeResult =
  | { ok: true; tier: PeerTier; invite: LinkInviteRecord }
  // 'other-node': the invite names another node. 'held': the invite names no node, and this node id
  // is held by a peer under another key. Neither uses the invite.
  | { ok: false; reason: 'unknown' | 'expired' | 'consumed' | 'other-node' | 'held' };

/**
 * Claim a token for `nodeId`, once.
 *
 * Every refusal is the same shape to the caller by design: introduce treats all three as "no invite"
 * and falls through to the ordinary pending path, so this never becomes a way to ask whether a given
 * token exists. Never throws — a storage failure is a refusal, because admitting a peer on a read
 * that did not complete is worse than making somebody re-run provisioning.
 */
export async function consumeLinkInvite(
  storage: Storage, token: unknown, nodeId: string,
  opts: {
    /** A peer holds `nodeId` under another key than the one presented: only an invite naming `nodeId` may replace it. */
    heldUnderAnotherKey?: boolean;
  } = {},
): Promise<ConsumeResult> {
  if (typeof token !== 'string' || !token.trim()) return { ok: false, reason: 'unknown' };
  try {
    const key = keyFor(token.trim());
    const record = await storage.getMemory(LINK_INVITE_GAII, key);
    if (!record) return { ok: false, reason: 'unknown' };

    const invite = record.value as unknown as LinkInviteRecord;
    if (!invite?.id) return { ok: false, reason: 'unknown' };
    if (invite.consumedAt) return { ok: false, reason: 'consumed' };
    if (new Date(invite.expiresAt).getTime() <= Date.now()) return { ok: false, reason: 'expired' };
    // Bound to a node: the invite is this operator's decision for that node id and no other. An
    // invite that names none admits a new node id, never one held under another key (secaudit2026oct26,
    // link-invite-not-bound-to-node-id-replaces-held-peer). Both leave the invite unused.
    if (invite.nodeId && invite.nodeId !== nodeId) return { ok: false, reason: 'other-node' };
    if (!invite.nodeId && opts.heldUnderAnotherKey) return { ok: false, reason: 'held' };

    const consumed: LinkInviteRecord = {
      ...invite,
      tier: coerceTier(invite.tier),
      consumedAt: new Date().toISOString(),
      consumedByNodeId: nodeId,
    };
    const next = {
      ...record,
      key,
      value: consumed as unknown as Record<string, unknown>,
      version: (record.version ?? 1) + 1,
      updatedAt: consumed.consumedAt!,
    };
    // Written on the version that was read: of two introductions with one token, one write lands and
    // the other is answered as a consumed invite.
    const landed = storage.setMemoryIfVersion
      ? !!await storage.setMemoryIfVersion(next, record.version)
      : (await storage.setMemory(next), true);
    if (!landed) return { ok: false, reason: 'consumed' };

    return { ok: true, tier: consumed.tier, invite: consumed };
  } catch (err) {
    logger.warn('consumeLinkInvite: refusing after a failed read', { error: String(err) });
    return { ok: false, reason: 'unknown' };
  }
}

/** Delete an invite by its id. Returns false when there was nothing by that id. */
export async function revokeLinkInvite(storage: Storage, id: string): Promise<boolean> {
  const records = await storage.listMemory(LINK_INVITE_GAII, { prefix: KEY_PREFIX });
  const match = records.find(r => (r.value as unknown as LinkInviteRecord)?.id === id);
  if (!match) return false;
  await storage.deleteMemory(LINK_INVITE_GAII, match.key);
  return true;
}
