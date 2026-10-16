/**
 * @file src/services/federation-trust-notice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A trust notice from this node to its peers: "this node removed, suspended or warns
 *   about node X". The emergency removal of a peer (federation-peer-remove.ts, with notify_network)
 *   and the operator's advisory (POST /v1/admin/federation/trust-advisory) send it. Each notice is a
 *   signed peer request to POST /v1/federation/trust-advisory on the other node, and the answer of
 *   each peer is read: the caller reports per peer whether the notice was accepted.
 *
 *   WHAT IS SIGNED. `{ source_node, target_node, advisory_type, reason, evidence_hash, timestamp }`
 *   as JSON, in that order (trustNoticeSignString), with the audience proof beside it
 *   (audienceProof: the node the notice is for, under a second signature). The receiving route
 *   verifies both, takes each notice once, and STORES it for its operator to read; it acts on
 *   nothing, because one node's word does not ban a third node on another node.
 * @structure trustNoticeSignString · TrustNotice · TrustNoticeOutcome · sendTrustNotice()
 * @usage const notices = await sendTrustNotice({ config, storage, peers }, { target_node, advisory_type, reason });
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial: the signed notice and the per-peer outcome, replacing an unsigned
 *     POST whose answer was not read (QA audit S6-06).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { sign } from '../auth/keypair.js';
import { audienceProof } from './signed-node-request.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { peerFetch } from '../utils/peer-fetch.js';

export const TRUST_ADVISORY_TYPES = ['warning', 'suspend', 'ban'] as const;
export type TrustAdvisoryType = typeof TRUST_ADVISORY_TYPES[number];

export interface TrustNotice {
  target_node: string;
  advisory_type: TrustAdvisoryType;
  reason: string;
  evidence_hash?: string | null;
}

/** The string a trust notice is signed over. The key order is the wire format. */
export function trustNoticeSignString(n: {
  source_node: string; target_node: string; advisory_type: string; reason: string; evidence_hash?: string | null; timestamp: string;
}): string {
  return JSON.stringify({
    source_node: n.source_node, target_node: n.target_node, advisory_type: n.advisory_type,
    reason: n.reason, evidence_hash: n.evidence_hash ?? '', timestamp: n.timestamp,
  });
}

/** One peer's answer to a notice. `accepted` is true only when the peer answered 2xx. */
export interface TrustNoticeOutcome {
  node: string;
  accepted: boolean;
  status?: number;
  code?: string;
  error?: string;
}

/**
 * Send a signed trust notice to every active peer except the target, and read each answer. Never
 * throws for one peer: a peer that cannot be asked, does not answer or refuses is an outcome.
 */
export async function sendTrustNotice(
  deps: { config: AimeatConfig; storage: Storage; peers: Map<string, PeerInfo> },
  notice: TrustNotice,
): Promise<TrustNoticeOutcome[]> {
  const { config, storage, peers } = deps;
  const targets = [...peers.values()].filter(p => p.status === 'active' && p.nodeId !== notice.target_node);
  if (targets.length === 0) return [];
  const key = await storage.getNodeKey();
  if (!key?.privateKey) {
    return targets.map(p => ({ node: p.nodeId, accepted: false, error: 'This node has no signing key, so no notice was sent.' }));
  }

  const outcomes: TrustNoticeOutcome[] = [];
  for (const peer of targets) {
    const check = await validateOutboundUrl(peer.url);
    if (!check.valid) {
      outcomes.push({ node: peer.nodeId, accepted: false, error: `The peer's address is not allowed: ${check.reason ?? 'URL validation failed'}` });
      continue;
    }
    const timestamp = new Date().toISOString();
    const fields = {
      source_node: config.nodeId, target_node: notice.target_node, advisory_type: notice.advisory_type,
      reason: notice.reason, evidence_hash: notice.evidence_hash ?? '', timestamp,
    };
    const signed = trustNoticeSignString(fields);
    const signature = await sign(key.privateKey, signed);
    const proof = await audienceProof(key.privateKey, signed, peer.nodeId);
    const answer = await peerFetch(`${peer.url}/v1/federation/trust-advisory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, signature, ...proof }),
    }, { timeoutMs: config.federationTimeoutMs ?? 5_000 });
    if (!answer.ok) {
      outcomes.push({ node: peer.nodeId, accepted: false, error: answer.message });
    } else if (answer.status >= 200 && answer.status < 300) {
      outcomes.push({ node: peer.nodeId, accepted: true, status: answer.status });
    } else {
      const body = answer.json as { error?: { code?: string; message?: string } } | undefined;
      outcomes.push({
        node: peer.nodeId, accepted: false, status: answer.status,
        code: body?.error?.code, error: body?.error?.message ?? `The peer answered HTTP ${answer.status}.`,
      });
    }
  }
  return outcomes;
}
