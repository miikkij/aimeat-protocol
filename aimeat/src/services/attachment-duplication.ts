/**
 * @file attachment-duplication.ts
 * @description Duplicates a direct message's media attachments into the recipient's own storage so
 *   the recipient co-owns their copy (DECISION #3: always duplicate). Same-node attachments are
 *   copied directly; cross-node attachments are pulled from the origin via the signed federation
 *   storage grant (DECISION #5). Respects the recipient's storage quota (DECISION #10): if a
 *   duplication would exceed quota the attachment stays a `reference` and the recipient is notified.
 * @structure
 *   - duplicateMessageAttachments(ctx, recipientGhii, message) → { attachments, changed }
 *   - requestStorageGrant(ctx, message, attachment) — recipient→origin signed grant + download
 * @usage import { duplicateMessageAttachments } from '../services/attachment-duplication.js';
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 4: attachments).
 */

import type { AimeatConfig } from '../config.js';
import type { Storage, DirectMessageRecord, DirectMessageAttachment } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { sign } from '../auth/keypair.js';
import { checkStorageQuota } from './quota.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';
import { safeFetch } from '../utils/url-validator.js';

export interface AttachmentCtx {
  config: AimeatConfig;
  storage: Storage;
  peers: Map<string, PeerInfo>;
}

function peerForNode(peers: Map<string, PeerInfo>, nodeId: string): PeerInfo | undefined {
  return [...peers.values()].find(p => p.nodeId === nodeId);
}

/** Recipient-side storage key for a duplicated attachment. */
function localKeyFor(message: DirectMessageRecord, att: DirectMessageAttachment): string {
  return `dm/${message.conversationId}/${message.id}/${att.id}`;
}

/**
 * Pull the raw bytes for an attachment. Same-node: read the origin owner's storage directly.
 * Cross-node: request a signed download grant from the origin node, then fetch the bytes.
 */
async function fetchAttachmentBytes(ctx: AttachmentCtx, message: DirectMessageRecord, att: DirectMessageAttachment): Promise<Buffer | null> {
  if (att.originNodeId === ctx.config.nodeId) {
    const file = await ctx.storage.getStorageFile(att.ownerGhii, att.storageKey);
    return file ? file.data : null;
  }
  return requestStorageGrant(ctx, message, att);
}

/** Recipient→origin: signed storage grant, then download the bytes from the returned URL. */
export async function requestStorageGrant(ctx: AttachmentCtx, message: DirectMessageRecord, att: DirectMessageAttachment): Promise<Buffer | null> {
  const peer = peerForNode(ctx.peers, att.originNodeId);
  if (!peer || !peer.url) return null;
  const nodeKey = await ctx.storage.getNodeKey();
  if (!nodeKey) return null;

  // Key order MUST match the grant endpoint's verification payload.
  const payload = {
    source_node: ctx.config.nodeId,
    message_id: message.id,
    conversation_id: message.conversationId,
    storage_key: att.storageKey,
    owner_ghii: att.ownerGhii,
    recipient_ghii: message.recipientGhii,
    timestamp: new Date().toISOString(),
  };
  try {
    const signature = await sign(nodeKey.privateKey, JSON.stringify(payload));
    // safeFetch validates + re-validates every redirect hop. The grant POST targets the peer-registry
    // URL; the download targets a URL the PEER returns in its JSON response (fully peer-controlled) —
    // safeFetch stops a malicious/compromised peer from pointing it at an internal/metadata address.
    const resp = await safeFetch(`${peer.url}/v1/federation/storage/grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-source-node': ctx.config.nodeId },
      body: JSON.stringify({ ...payload, signature }),
      signal: AbortSignal.timeout(ctx.config.federationTimeoutMs),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { data?: { download_url?: string } };
    const url = data?.data?.download_url;
    if (!url) return null;
    const dl = await safeFetch(url, { signal: AbortSignal.timeout(ctx.config.federationTimeoutMs) });
    if (!dl.ok) return null;
    return Buffer.from(await dl.arrayBuffer());
  } catch (err) {
    logger.warn('storage grant/download failed', { error: err instanceof Error ? err.message : String(err), node: att.originNodeId });
    return null;
  }
}

/**
 * Duplicate every not-yet-duplicated attachment of `message` into `recipientGhii`'s storage. Returns
 * the (possibly) updated attachment descriptors and whether anything changed. Attachments that can't
 * be duplicated yet (over quota, or bytes unavailable) stay `reference` and are retried later.
 */
export async function duplicateMessageAttachments(
  ctx: AttachmentCtx,
  recipientGhii: string,
  message: DirectMessageRecord,
): Promise<{ attachments: DirectMessageAttachment[]; changed: boolean }> {
  const atts = message.attachments;
  if (!atts || atts.length === 0) return { attachments: atts ?? [], changed: false };

  let changed = false;
  let quotaNotified = false;
  const result: DirectMessageAttachment[] = [];

  for (const att of atts) {
    if (att.mode === 'duplicate' && att.localKey) { result.push(att); continue; }
    if (att.expired) { result.push(att); continue; }   // terminal — never retried

    const quota = await checkStorageQuota(ctx.config, ctx.storage, recipientGhii, att.size);
    if (!quota.allowed) {
      // Over quota — keep as reference; the message text is already delivered. Notify once.
      result.push({ ...att, mode: 'reference' });
      if (!quotaNotified) {
        quotaNotified = true;
        await notify(ctx.storage, recipientGhii, {
          type: 'direct_message_attachment_quota',
          title: 'Attachment held — storage full',
          body: `Free up space to receive: ${att.name ?? att.storageKey}`,
          link: '/v1/profile#inbox',
        });
      }
      continue;
    }

    const bytes = await fetchAttachmentBytes(ctx, message, att);
    if (!bytes) { result.push({ ...att, mode: 'reference' }); continue; }

    const localKey = localKeyFor(message, att);
    await ctx.storage.createStorageFile({
      key: localKey,
      ownerGaii: recipientGhii,
      visibility: 'private',
      mimeType: att.mime,
      size: bytes.length,
      data: bytes,
      tags: ['dm-attachment'],
      createdAt: new Date().toISOString(),
    });
    result.push({ ...att, mode: 'duplicate', localKey });
    changed = true;
  }

  return { attachments: result, changed };
}

/**
 * Periodic sweep (DECISION #10): re-attempt attachments that are still `reference` (held because the
 * recipient was over quota or the bytes were briefly unavailable), and — once a held attachment is
 * older than the retry TTL — mark it `expired` so it stops retrying. The message text is unaffected;
 * the recipient just sees an "attachment expired" marker. Runs alongside the message retry job.
 * Returns counts for logging. Never throws.
 */
export async function sweepReferenceAttachments(ctx: AttachmentCtx): Promise<{ retried: number; expired: number }> {
  const ttlMs = ctx.config.messageRetryTtlHours * 3600_000;
  const now = Date.now();
  let retried = 0, expired = 0;

  const msgs = await ctx.storage.listInboundWithAttachments(200).catch(err => { logger.warn('sweepReferenceAttachments: continuing after a suppressed failure', { error: String(err) }); return []; });
  for (const m of msgs) {
    const atts = m.attachments || [];
    const held = atts.some(a => a.mode === 'reference' && !a.expired);
    if (!held) continue;

    if (now - new Date(m.createdAt).getTime() > ttlMs) {
      const updated = atts.map(a => (a.mode === 'reference' && !a.expired) ? { ...a, expired: true } : a);
      await ctx.storage.updateMessageAttachments(m.id, m.ownerGhii, updated).catch(err => { logger.warn('sweepReferenceAttachments: continuing after a suppressed failure', { error: String(err) }); });
      expired++;
      await notify(ctx.storage, m.ownerGhii, {
        type: 'direct_message_attachment_expired',
        title: 'An attachment expired',
        body: `An attachment from ${m.senderGhii} could not be received in time and was dropped.`,
        link: `/v1/profile#inbox/${m.conversationId}`,
      });
      continue;
    }

    const dup = await duplicateMessageAttachments(ctx, m.ownerGhii, m);
    if (dup.changed) { await ctx.storage.updateMessageAttachments(m.id, m.ownerGhii, dup.attachments).catch(err => { logger.warn('sweepReferenceAttachments: continuing after a suppressed failure', { error: String(err) }); }); retried++; }
  }
  return { retried, expired };
}
