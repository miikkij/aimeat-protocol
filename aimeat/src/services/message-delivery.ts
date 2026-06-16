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

import type { AimeatConfig } from '../config.js';
import type { Storage, DirectMessageRecord } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { sign } from '../auth/keypair.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

export interface DeliveryCtx {
  config: AimeatConfig;
  storage: Storage;
  peers: Map<string, PeerInfo>;
}

/** Build the canonical signed payload for a message delivery. Key order MUST match the receiver. */
function buildMessagePayload(config: AimeatConfig, record: DirectMessageRecord) {
  return {
    source_node: config.nodeId,
    message: {
      id: record.id,
      conversationId: record.conversationId,
      senderGhii: record.senderGhii,
      recipientGhii: record.recipientGhii,
      body: record.body,
      attachments: record.attachments ?? null,
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
export async function deliverDirectMessage(ctx: DeliveryCtx, record: DirectMessageRecord): Promise<'delivered' | 'queued' | 'undeliverable'> {
  const { config, storage, peers } = ctx;
  const targetNode = parseGaiiLoose(record.recipientGhii).node;

  const peer = peerForNode(peers, targetNode);
  if (!peer || peer.status === 'offline' || peer.status === 'unreachable') {
    // Peer not reachable — leave queued; the retry job will try again (no failure counted).
    return 'queued';
  }

  const nodeKey = await storage.getNodeKey();
  if (!nodeKey) return 'queued';

  const payload = buildMessagePayload(config, record);
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
      return 'delivered';
    }
    if (resp.status === 403) {
      // Recipient blocked the sender (or policy denied) — terminal, do not retry.
      let reason = 'rejected';
      try { reason = ((await resp.json()) as { error?: { code?: string } })?.error?.code ?? 'rejected'; } catch { /* ignore */ }
      await storage.updateMessageDeliveryStatus(record.id, 'undeliverable', { error: reason });
      return 'undeliverable';
    }
    // Transient remote error — keep queued for retry.
    await storage.updateMessageDeliveryStatus(record.id, 'queued', { error: `http_${resp.status}` });
    return 'queued';
  } catch (err) {
    await storage.updateMessageDeliveryStatus(record.id, 'queued', { error: err instanceof Error ? err.message : 'network_error' });
    return 'queued';
  }
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
      await deliverDirectMessage(ctx, msg);
    }
  }

  return setInterval(() => {
    sweep().catch(err => logger.error('message retry sweep failed', { error: (err as Error).message }));
  }, config.messageRetryIntervalMs);
}
