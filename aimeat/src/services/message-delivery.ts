/**
 * @file message-delivery.ts
 * @description Cross-node delivery for human↔human direct messages. Signs an outbound message with
 *   the node Ed25519 key and POSTs it to the recipient node's federation receive endpoint; mirrors
 *   the signing/verification pattern used by memory replication. Also propagates read receipts and
 *   runs the retry job for messages that were queued while a peer was unreachable.
 * @structure
 *   - deliverDirectMessage(ctx, record) → 'delivered' | 'queued' | 'undeliverable'
 *   - propagateReadReceipt(ctx, message) — local update or signed receipt to the origin node
 *   - startMessageRetryJob(config, storage, peers) — periodic sweep (DECISION #6)
 * @usage import { deliverDirectMessage, startMessageRetryJob } from '../services/message-delivery.js';
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 3: federation delivery).
 */

import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, DirectMessageRecord, MessageDeliveryLog } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { sign } from '../auth/keypair.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { deliveryTargetFor } from '../utils/messaging.js';
import { logger } from '../utils/logger.js';
import { sweepReferenceAttachments } from './attachment-duplication.js';

export interface DeliveryCtx {
  config: AimeatConfig;
  storage: Storage;
  peers: Map<string, PeerInfo>;
}

/** Build the canonical signed payload for a message delivery. Key order MUST match the receiver.
 *  `recipientGhii` is the ACTUAL recipient (may be an agent/eco GAII) — preserved so the recipient node
 *  can store it and the agent can read its own DMs cross-node. `deliveryGhii` is the human GHII whose
 *  mailbox the copy lands in (the owner of an agent/eco recipient, or the recipient itself for a human),
 *  so the human still sees + gates the message. An older peer that ignores `deliveryGhii` falls back to
 *  `recipientGhii` as the mailbox owner (its receiver already parses owner+node from a GAII). */
function buildMessagePayload(config: AimeatConfig, record: DirectMessageRecord, deliveryGhii: string) {
  return {
    source_node: config.nodeId,
    message: {
      id: record.id,
      conversationId: record.conversationId,
      subject: record.subject ?? null,
      senderGhii: record.senderGhii,
      recipientGhii: record.recipientGhii,
      deliveryGhii,
      body: record.body,
      attachments: record.attachments ?? null,
      interactive: record.interactive ?? null,
      replyToId: record.replyToId ?? null,
      createdAt: record.createdAt,
    },
    timestamp: new Date().toISOString(),
  };
}

function peerForNode(peers: Map<string, PeerInfo>, nodeId: string): PeerInfo | undefined {
  return [...peers.values()].find(p => p.nodeId === nodeId);
}

/**
 * Attempt to deliver a queued outbound message to its recipient node. Updates the sender's copy
 * status and returns the outcome. Never throws.
 */
export async function deliverDirectMessage(ctx: DeliveryCtx, record: DirectMessageRecord, deliveryGhii: string = record.recipientGhii): Promise<'delivered' | 'queued' | 'undeliverable'> {
  const { config, storage, peers } = ctx;
  const targetNode = parseGaiiLoose(deliveryGhii).node;
  const started = Date.now();

  // Operator telemetry — never carries content or participant identities, only routing/outcome.
  const log = (status: MessageDeliveryLog['status'], extra?: { httpStatus?: number; errorMessage?: string }) =>
    logDelivery(ctx, { messageId: record.id, origin: 'federation', targetNodeId: targetNode, status, latencyMs: Date.now() - started, ...extra });

  const peer = peerForNode(peers, targetNode);
  if (!peer || peer.status === 'offline' || peer.status === 'unreachable') {
    // Peer not reachable — leave queued; the retry job will try again (no failure counted).
    await log('queued', { errorMessage: peer ? `peer_${peer.status}` : 'no_peer' });
    return 'queued';
  }

  const nodeKey = await storage.getNodeKey();
  if (!nodeKey) { await log('queued', { errorMessage: 'no_node_key' }); return 'queued'; }

  const payload = buildMessagePayload(config, record, deliveryGhii);
  const signature = await sign(nodeKey.privateKey, JSON.stringify(payload));

  try {
    const resp = await fetch(`${peer.url}/v1/federation/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-source-node': config.nodeId },
      body: JSON.stringify({ ...payload, signature }),
      signal: AbortSignal.timeout(config.federationTimeoutMs),
    });
    if (resp.ok) {
      await storage.updateMessageDeliveryStatus(record.id, 'delivered', { deliveredAt: new Date().toISOString() });
      await log('delivered', { httpStatus: resp.status });
      return 'delivered';
    }
    if (resp.status === 403) {
      // Recipient blocked the sender (or policy denied) — terminal, do not retry.
      let reason = 'rejected';
      try { reason = ((await resp.json()) as { error?: { code?: string } })?.error?.code ?? 'rejected'; } catch { /* ignore */ }
      await storage.updateMessageDeliveryStatus(record.id, 'undeliverable', { error: reason });
      await log('undeliverable', { httpStatus: resp.status, errorMessage: reason });
      return 'undeliverable';
    }
    // Transient remote error — keep queued for retry.
    await storage.updateMessageDeliveryStatus(record.id, 'queued', { error: `http_${resp.status}` });
    await log('queued', { httpStatus: resp.status, errorMessage: `http_${resp.status}` });
    return 'queued';
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network_error';
    await storage.updateMessageDeliveryStatus(record.id, 'queued', { error: msg });
    await log('queued', { errorMessage: msg });
    return 'queued';
  }
}

/** Append a delivery-log row (best-effort; telemetry must never break delivery). */
export async function logDelivery(ctx: DeliveryCtx, entry: Omit<MessageDeliveryLog, 'id' | 'createdAt'>): Promise<void> {
  try {
    await ctx.storage.appendMessageDeliveryLog({ ...entry, id: randomUUID(), createdAt: new Date().toISOString() });
  } catch { /* telemetry is best-effort */ }
}

/**
 * Propagate a read receipt for a message the caller just read. If the sender is on this node, update
 * locally; otherwise POST a signed receipt to the sender's node. Best-effort — never throws.
 */
export async function propagateReadReceipt(ctx: DeliveryCtx, message: DirectMessageRecord, readAt: string): Promise<void> {
  const { config, storage, peers } = ctx;
  const senderNode = parseGaiiLoose(message.senderGhii).node;
  if (senderNode === config.nodeId) {
    await storage.setMessageReadReceipt(message.id, readAt);
    return;
  }
  const peer = peerForNode(peers, senderNode);
  if (!peer || !peer.url) return;
  const nodeKey = await storage.getNodeKey();
  if (!nodeKey) return;
  const payload = { source_node: config.nodeId, message_id: message.id, kind: 'read' as const, timestamp: readAt };
  try {
    const signature = await sign(nodeKey.privateKey, JSON.stringify(payload));
    await fetch(`${peer.url}/v1/federation/message/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-source-node': config.nodeId },
      body: JSON.stringify({ ...payload, signature }),
      signal: AbortSignal.timeout(config.federationTimeoutMs),
    });
  } catch {
    /* best-effort: a lost read receipt only affects the sender's UI, not correctness */
  }
}

/**
 * Periodic retry of queued/failed outbound cross-node messages (DECISION #6). Only reachable peers
 * are attempted; messages older than the TTL are retired to `undeliverable`. Returns the interval
 * handle so the caller can clear it on shutdown.
 */
export function startMessageRetryJob(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): ReturnType<typeof setInterval> {
  const ttlMs = config.messageRetryTtlHours * 3600_000;
  const ctx: DeliveryCtx = { config, storage, peers };

  async function sweep(): Promise<void> {
    const pending = await storage.listOutboundForRetry(200);
    const now = Date.now();
    for (const msg of pending) {
      // Only cross-node messages are deliverable here; local ones are delivered inline at send time.
      if (parseGaiiLoose(msg.recipientGhii).node === config.nodeId) continue;
      if (now - new Date(msg.createdAt).getTime() > ttlMs) {
        await storage.updateMessageDeliveryStatus(msg.id, 'undeliverable', { error: 'retry_ttl_expired' });
        continue;
      }
      await deliverDirectMessage(ctx, msg, deliveryTargetFor(msg.recipientGhii));
    }
    // Also re-attempt / expire held (reference) attachments on the recipient side (DECISION #10).
    await sweepReferenceAttachments(ctx).catch(err => logger.error('attachment sweep failed', { error: (err as Error).message }));
    // Cap the delivery-telemetry log so it can't grow unbounded.
    await storage.pruneMessageDeliveryLogs(10000).catch(() => {});
  }

  return setInterval(() => {
    sweep().catch(err => logger.error('message retry sweep failed', { error: (err as Error).message }));
  }, config.messageRetryIntervalMs);
}
