/**
 * @file message-broadcast.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.3.0 — 2026-09-14 — broadcastFromPrincipal() takes stampProvenance() and calls it below its
 *     own refusals. Both doors stamped the record first, and stamping WRITES one, so a broadcast
 *     refused for an operator-only audience or an empty recipient list left a row describing the
 *     caller's content behind for a message nobody received. Invariant 14.
 *   v1.2.0 — 2026-09-06 — broadcastFromPrincipal(): the whole send-to-many, minus the HTTP, so
 *     aimeat_dm_broadcast is not a second copy of the route's five decisions. A broadcast carries a
 *     `subject` (titling the thread each recipient sees) and one aiProvenanceId across every copy.
 *   v1.1.0 — 2026-08-15 — A Share Group audience is resolved only for a sender who is that group's
 *     owner or one of its members, the same test its read door makes. Holding the id was enough
 *     before, and a removed member keeps the id: they could broadcast into the group and read every
 *     current member's identity off the broadcast's own receipt, on a group whose GET answers them
 *     403. E2E test-quality audit finding A29.
 *   v1.0.0 — 2026-06-23 — Initial: explicit-list + Share-Group audiences, announcement/broadcast modes.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { DirectMessageAttachment, InteractivePayload, SharingGroupRecord, Storage } from '../storage/interface.js';
import { provenanceForWrite, type DeclaredProvenance } from './ai-provenance.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { isAddressableRecipient } from '../utils/messaging.js';
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
  /** Titles the thread each copy opens. Every copy still carries the shared broadcastId, so a titled
   *  announcement is as foldable in the recipients' lists as an untitled one. */
  subject?: string;
  attachments?: DirectMessageAttachment[];
  interactive?: InteractivePayload;
  /** Auto-accept first contact (operator announcements land in inbox, not requests). */
  skipContactGate?: boolean;
  /** TARGET-058: the provenance record describing the body. Every copy carries the SAME id, because
   *  the statement is about the bytes and one broadcast is one set of bytes. */
  aiProvenanceId?: string;
}

export interface BroadcastResult {
  broadcastId: string;
  sent: number;
  failed: { recipient: string; code: string }[];
}

/**
 * May this sender address that group? Owner or member, the same test the group's own read door
 * makes. An agent broadcasts for its human, so `bot#alice@node` counts wherever `alice@node` does:
 * both the group's owner field and a member entry may hold either form.
 */
function isGroupAudienceAllowed(group: SharingGroupRecord, senderGhii: string): boolean {
  const senderOwner = ownerGhiiOf(senderGhii);
  const matches = (identifier: string): boolean =>
    identifier === senderGhii || identifier === senderOwner || ownerGhiiOf(identifier) === senderOwner;
  return matches(group.ownerGaii) || group.members.some(m => matches(m.identifier));
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
    // Same question GET /v1/groups/:id asks (routes/sharing-groups.ts:120): owner or member. A
    // group id is a v4 UUID, so it is not guessable — but every removed member still knows it, and
    // resolving the audience unchecked both delivered to the group and, through the broadcast's own
    // receipt, handed the sender the identity of every current member of a group they are refused a
    // 403 on. Silent skip rather than a throw: the route already answers INVALID_INPUT when the
    // audience resolves to nobody, and an outsider must not learn whether the id exists.
    if (group && isGroupAudienceAllowed(group, senderGhii)) {
      for (const m of group.members) set.add(m.identifier);
    } else if (group) {
      logger.warn('broadcast: group audience refused, sender is neither owner nor member', {
        groupId: sel.groupId, sender: senderGhii,
      });
    }
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
        subject: input.subject,
        attachments: input.attachments,
        interactive: input.interactive,
        broadcastId,
        respondable,
        skipContactGate: input.skipContactGate,
        aiProvenanceId: input.aiProvenanceId,
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

/**
 * One send-to-many, from the principal down to the delivered copies: the whole of what
 * POST /v1/messages/broadcast does, minus the HTTP.
 *
 * It exists because the MCP tool must not be a second implementation of it. The operator gate, the
 * audience resolution, the addressability filter, the empty-audience refusal and the federation
 * fan-out are five decisions, and having them in a route means the tool either skips them or copies
 * them. Both have happened on this surface before. The route is a thin caller now, and so is the tool.
 *
 * `isOperator` is passed in rather than read from a request: a service takes the caller, not the
 * Express object, and the two doors authenticate differently.
 */
/**
 * The AI-provenance stamp a broadcast carries, as a function to be called once the audience has
 * been judged — see `stampProvenance` below for why it is deferred.
 *
 * ONE IMPLEMENTATION, because the two doors had a copy each and they had already drifted in what
 * they hashed. What a broadcast records is the same on both: the body and the questions a person
 * reads, private, to a human audience, under this node's label policy. What DIFFERS is the caller's
 * own declaration — the MCP tool carries the agent's, the REST route stamps from the principal —
 * and which door it was, so those are the arguments.
 */
export function broadcastProvenanceStamp(
  deps: { storage: Storage; config: AimeatConfig },
  input: {
    principal: string;
    body?: string;
    questions?: Array<{ header?: string; prompt?: string }>;
    pipeline: 'rest.messages_broadcast' | 'mcp.dm_broadcast';
    declaredId?: string;
    declared?: DeclaredProvenance;
  },
): () => Promise<string | undefined> {
  const { storage, config } = deps;
  return () => provenanceForWrite(storage, {
    principal: input.principal,
    // The questions are content a person reads, exactly as in aimeat_dm_ask, so they are hashed
    // with the body rather than left out of the record.
    content: [input.body ?? '', ...(input.questions ?? []).map(q => `${q.header ?? ''} ${q.prompt ?? ''}`)].join('\n'),
    declaredId: input.declaredId,
    declared: input.declared,
    pipeline: input.pipeline,
    surface: { visibility: 'private', humanAudience: true },
    labelPolicy: config.aiLabelPublic,
    nodeId: config.nodeId,
    baseUrl: config.baseUrl,
    enabled: config.aiProvenance,
  });
}

export async function broadcastFromPrincipal(
  ctx: DeliveryCtx,
  input: {
    senderGhii: string;
    isOperator: boolean;
    to?: string[];
    groupId?: string;
    audience?: 'node-users' | 'federation-users';
    mode: 'broadcast' | 'announcement';
    body?: string;
    subject?: string;
    attachments?: DirectMessageAttachment[];
    interactive?: InteractivePayload;
    /**
     * Stamps the AI-provenance record and answers with its id. A FUNCTION rather than a value,
     * because stamping it WRITES one, and both doors were calling that before this function could
     * refuse the audience — so an agent told "a node-wide audience is operator-only", or handed
     * an empty recipient list, left a provenance row in the database for a message nobody ever
     * received. Called here, below both refusals and above the first delivery. Invariant 14, found
     * by the AI triage of 2026-09-13.
     *
     * It stays the caller's to supply, because the two doors declare it differently: the MCP tool
     * carries the agent's own declaration, the REST route stamps from the principal. Both end on
     * every copy.
     */
    stampProvenance?: () => Promise<string | undefined>;
  },
): Promise<
  | {
      ok: true; broadcastId: string; recipients: number; sent: number;
      failed: { recipient: string; code: string }[]; federationPeers: number;
      /** What stampProvenance answered, for the door that echoes the record back to its caller. */
      aiProvenanceId?: string;
    }
  | { ok: false; status: number; code: string; message: string }
> {
  // "All node users" and "all federation users" are operator-only: a node-wide announcement reaches
  // every human here and auto-accepts the contact for each of them.
  const isOperatorAudience = input.audience === 'node-users' || input.audience === 'federation-users';
  if (isOperatorAudience && !input.isOperator) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'A node/federation-wide audience is operator-only' };
  }

  const recipients = (await resolveAudience(ctx, input.senderGhii, { to: input.to, groupId: input.groupId, audience: input.audience }))
    .filter(isAddressableRecipient);
  // federation-users still proceeds with no LOCAL recipients — peers deliver to their own owners.
  if (recipients.length === 0 && input.audience !== 'federation-users') {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'No valid recipients in the audience' };
  }

  // Nothing above this line has written anything, which is the point of the line being here.
  const aiProvenanceId = await input.stampProvenance?.();

  const result = await sendBroadcast(ctx, {
    senderGhii: input.senderGhii, recipients, mode: input.mode, body: input.body, subject: input.subject,
    attachments: input.attachments, interactive: input.interactive, skipContactGate: isOperatorAudience,
    aiProvenanceId,
  });

  let federationPeers = 0;
  if (input.audience === 'federation-users') {
    const fed = await broadcastToFederation(ctx, {
      senderGhii: input.senderGhii, mode: input.mode, body: input.body, subject: input.subject,
      interactive: input.interactive, broadcastId: result.broadcastId,
    });
    federationPeers = fed.peers;
  }

  return { ok: true, broadcastId: result.broadcastId, recipients: recipients.length, sent: result.sent, failed: result.failed, federationPeers, aiProvenanceId };
}

/** Delegated federation broadcast: send the announcement to each ACTIVE peer's /v1/federation/broadcast
 *  (signed with the node key). Each peer enumerates ITS OWN owners and delivers locally — so one frame
 *  per peer, not one message per federation user, and peer autonomy is preserved (a peer accepts only
 *  from active peers). Returns how many peers accepted it. */
export async function broadcastToFederation(
  ctx: DeliveryCtx,
  input: { senderGhii: string; mode: 'broadcast' | 'announcement'; body?: string; subject?: string; interactive?: InteractivePayload; broadcastId: string },
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
          // Additive on the wire: a peer on older code ignores it, and a peer on newer code reading an
          // older frame sees undefined, which is what an untitled announcement has always been.
          subject: input.subject ?? null,
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
