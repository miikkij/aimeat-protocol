/**
 * @file message-broadcast.ts
 * @description Send-to-many (broadcast / mass posting). Resolves an audience — an explicit recipient list
 *   and/or a Share Group's members (the group's natural job as a distribution list) — and fans out one
 *   ordinary direct message per recipient via sendDirectMessage, tagged with a shared `broadcastId` so the
 *   copies can be aggregated for a results view. A broadcast is genuinely N separate 1:1s (not a shared
 *   thread), so reusing the per-recipient DM model + its federation/delivery is correct. `mode` =
 *   'announcement' marks the copies non-respondable (the recipient cannot reply); 'broadcast' is a normal
 *   message each recipient can reply to (a 1:1 thread). Polls (an `interactive` question spec) ride the
 *   same fan-out — see Phase 2.
 * @structure resolveAudience(ctx, senderGhii, sel) → string[] · sendBroadcast(ctx, input) → BroadcastResult
 * @usage import { resolveAudience, sendBroadcast } from '../services/message-broadcast.js';
 * @version-history
 *   v1.0.0 — 2026-06-23 — Initial: explicit-list + Share-Group audiences, announcement/broadcast modes.
 */
import { randomUUID } from 'node:crypto';
import type { DirectMessageAttachment, InteractivePayload } from '../storage/interface.js';
import type { DeliveryCtx } from './message-delivery.js';
import { sendDirectMessage } from './message-send.js';
import { sign } from '../auth/keypair.js';
import { logger } from '../utils/logger.js';

export interface AudienceSelector {
  /** Explicit recipient identities (owner@node, agent#owner@node, eco:app#owner@node). */
  to?: string[];
  /** A Share Group id whose members become recipients (a reusable distribution list). */
  groupId?: string;
  /** 'node-users' = every human owner on this node; 'federation-users' = that PLUS every owner on each
   *  active peer (delivered by fanning the broadcast out to peers — see broadcastToFederation). Both
   *  OPERATOR-ONLY (gate at the route). resolveAudience returns only the LOCAL owners for either. */
  audience?: 'node-users' | 'federation-users';
}

export interface BroadcastInput {
  senderGhii: string;
  recipients: string[];
  mode: 'broadcast' | 'announcement';
  body?: string;
  attachments?: DirectMessageAttachment[];
  interactive?: InteractivePayload;
  /** Auto-accept first contact (operator announcements land in inbox, not requests). */
  skipContactGate?: boolean;
}

export interface BroadcastResult {
  broadcastId: string;
  sent: number;
  failed: { recipient: string; code: string }[];
}

/** Resolve an audience selector to a de-duplicated recipient list (minus the sender). */
export async function resolveAudience(ctx: DeliveryCtx, senderGhii: string, sel: AudienceSelector): Promise<string[]> {
  const set = new Set<string>();
  for (const r of sel.to ?? []) {
    const t = r.trim();
    if (t) set.add(t);
  }
  if (sel.groupId) {
    const group = await ctx.storage.getSharingGroup(sel.groupId);
    if (group) for (const m of group.members) set.add(m.identifier);
  }
  if (sel.audience === 'node-users' || sel.audience === 'federation-users') {
    const ghiis = await ctx.storage.listGHIIs();   // local owners; peers are reached via broadcastToFederation
    for (const g of ghiis) if (g.ghii) set.add(g.ghii);
  }
  set.delete(senderGhii); // never broadcast to yourself
  return [...set];
}

/** Fan out one direct message per recipient under a shared broadcastId. Never throws on a single bad
 *  recipient — collects per-recipient failures so a partial broadcast still reports what landed. */
export async function sendBroadcast(ctx: DeliveryCtx, input: BroadcastInput): Promise<BroadcastResult> {
  const broadcastId = randomUUID();
  const respondable = input.mode !== 'announcement';
  const failed: { recipient: string; code: string }[] = [];
  let sent = 0;
  for (const recipientGhii of input.recipients) {
    if (recipientGhii === input.senderGhii) continue;
    try {
      const result = await sendDirectMessage(ctx, {
        senderGhii: input.senderGhii,
        recipientGhii,
        body: input.body ?? '',
        attachments: input.attachments,
        interactive: input.interactive,
        broadcastId,
        respondable,
        skipContactGate: input.skipContactGate,
      });
      if (result.ok) sent++;
      else failed.push({ recipient: recipientGhii, code: result.code });
    } catch (err) {
      logger.warn('message-broadcast: suppressed failure, continuing', { error: String(err) });
      failed.push({ recipient: recipientGhii, code: 'SEND_FAILED' });
    }
  }
  return { broadcastId, sent, failed };
}

/** Delegated federation broadcast: send the announcement to each ACTIVE peer's /v1/federation/broadcast
 *  (signed with the node key). Each peer enumerates ITS OWN owners and delivers locally — so one frame
 *  per peer, not one message per federation user, and peer autonomy is preserved (a peer accepts only
 *  from active peers). Returns how many peers accepted it. */
export async function broadcastToFederation(
  ctx: DeliveryCtx,
  input: { senderGhii: string; mode: 'broadcast' | 'announcement'; body?: string; interactive?: InteractivePayload; broadcastId: string },
): Promise<{ peers: number }> {
  const { config, storage, peers } = ctx;
  const active = [...peers.values()].filter(p => p.status === 'active' && p.peerMode !== 'private');
  if (!active.length) return { peers: 0 };
  const nodeKey = await storage.getNodeKey();
  let count = 0;
  for (const peer of active) {
    try {
      const payload = {
        source_node: config.nodeId,
        broadcast: {
          broadcastId: input.broadcastId,
          senderGhii: input.senderGhii,
          body: input.body ?? '',
          interactive: input.interactive ?? null,
          respondable: input.mode !== 'announcement',
          createdAt: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      };
      const signature = nodeKey?.privateKey ? await sign(nodeKey.privateKey, JSON.stringify(payload)) : undefined;
      const resp = await fetch(`${peer.url}/v1/federation/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-source-node': config.nodeId },
        body: JSON.stringify({ ...payload, signature }),
        signal: AbortSignal.timeout(config.federationTimeoutMs ?? 5000),
      });
      if (resp.ok) count++;
    } catch (err) {
      logger.warn('Federation broadcast to peer failed', { peer: peer.nodeId, error: (err as Error).message });
    }
  }
  return { peers: count };
}
