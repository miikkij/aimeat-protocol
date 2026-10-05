/**
 * @file src/services/signed-node-request.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One signed request from one node to another: the headers a node signs it with, and
 *   the check the receiving node makes. A package pull or attestation (package-node-auth.ts), a sale
 *   request and a claim (package-sale-auth.ts) are each this, with their own signed fields.
 *
 *   WHAT IS SIGNED. `{ source_node, timestamp, ...fields, audience, nonce }` as JSON, in that order:
 *   the sending node, the moment, what the request is (each kind names its fields: a purpose, a
 *   group, a method, a path, a body digest), the node it is for and a one-time value. The order is
 *   the wire format, so it never changes; a node on the previous version signs the same string.
 *
 *   WHAT IS CHECKED, in this order: the three headers are there; the key that should have signed it
 *   (a peer's, or the key the request itself names); the timestamp within five minutes; the audience
 *   is this node and a nonce is there; the signature; then the nonce is accepted once, after the
 *   signature, so a forged request cannot use up a real node's nonce.
 *
 *   WHY ONE MODULE. The three verifiers wrote these steps out three times (secaudit 2026-10, C6). A
 *   step added to one, as the audience and nonce were on 2026-10-05 (PKG-10), had to be added to each.
 * @structure NodeRequestCheck · signNodeRequest(storage, config, audience, fields) ·
 *   checkNodeRequest(headers, opts)
 * @usage
 *   const headers = await signNodeRequest(storage, config, peerId, { purpose: 'package', group_id });
 *   const who = await checkNodeRequest(req.headers, { thisNodeId, fields, keyOf: (node) => ... });
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial: the shared steps of package-node-auth.ts and package-sale-auth.ts
 *     (secaudit 2026-10, C6).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { sign, verify } from '../auth/keypair.js';
import { newNonce, nonceAccepted, NONCE_WINDOW_MS } from './request-nonce.js';

export type NodeRequestCheck =
  | { ok: true; nodeId: string }
  | { ok: false; status: number; code: string; message: string };

type Refusal = Extract<NodeRequestCheck, { ok: false }>;

/** The string a node signs. The key order is the wire format. */
function message(sourceNode: string, timestamp: string, fields: Record<string, string>, audience: string, nonce: string): string {
  return JSON.stringify({ source_node: sourceNode, timestamp, ...fields, audience, nonce });
}

/** Headers that prove this node asked `audience` for the request `fields` describe, or none when the node has no key yet. */
export async function signNodeRequest(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, audience: string, fields: Record<string, string>,
): Promise<Record<string, string>> {
  const key = await storage.getNodeKey();
  if (!key?.privateKey) return {};
  const timestamp = new Date().toISOString();
  const nonce = newNonce();
  return {
    'x-source-node': config.nodeId,
    'x-timestamp': timestamp,
    'x-audience': audience,
    'x-nonce': nonce,
    'x-signature': await sign(key.privateKey, message(config.nodeId, timestamp, fields, audience, nonce)),
  };
}

/**
 * Which node signed this request, checked in the order the file header gives. `keyOf` answers the
 * public key the named node must have signed with, or the refusal (an unknown or inactive peer).
 * The two sentences let each kind of request word its own refusals.
 */
export async function checkNodeRequest(
  headers: Record<string, string | string[] | undefined>,
  opts: {
    thisNodeId: string;
    fields: Record<string, string>;
    keyOf: (sourceNode: string) => Promise<{ publicKey: string } | Refusal> | { publicKey: string } | Refusal;
    missingMessage: string;
    badSignatureMessage: string;
    now?: number;
  },
): Promise<NodeRequestCheck> {
  const pick = (h: string): string | undefined => { const v = headers[h]; return Array.isArray(v) ? v[0] : v; };
  const now = opts.now ?? Date.now();
  const sourceNode = pick('x-source-node');
  const signature = pick('x-signature');
  const timestamp = pick('x-timestamp');
  if (!sourceNode || !signature || !timestamp) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: opts.missingMessage };
  }
  const key = await opts.keyOf(sourceNode);
  if ('ok' in key) return key;
  const ts = Date.parse(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > NONCE_WINDOW_MS) {
    return { ok: false, status: 400, code: 'STALE_TIMESTAMP', message: 'The timestamp is missing, invalid, or outside the 5-minute window.' };
  }
  const audience = pick('x-audience');
  const nonce = pick('x-nonce');
  if (audience !== opts.thisNodeId || !nonce) {
    return {
      ok: false, status: 401, code: 'UNAUTHORIZED',
      message: `A signed request names the node it is for (x-audience: ${opts.thisNodeId}) and a one-time x-nonce. A node that sends neither runs an older version.`,
    };
  }
  if (!await verify(key.publicKey, message(sourceNode, timestamp, opts.fields, audience, nonce), signature)) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: opts.badSignatureMessage };
  }
  // After the signature, so a forged request cannot use up a real node's nonce.
  if (!nonceAccepted(sourceNode, nonce, now)) {
    return { ok: false, status: 401, code: 'REPLAYED', message: 'This signed request was already received. A node signs every request anew.' };
  }
  return { ok: true, nodeId: sourceNode };
}
