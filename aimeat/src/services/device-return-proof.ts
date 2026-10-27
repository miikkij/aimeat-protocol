/**
 * @file src/services/device-return-proof.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a device-authorization request that names an EXISTING agent was made by that
 *   agent coming back, or by a new device taking it over.
 *
 *   WHY (secaudit2026oct22, device-auth-approve.ts:unbound-reapproval-of-existing-agent; developer
 *   decision 2026-10-25). POST /v1/agents/device-authorize needs no credential, and a request that
 *   names an agent the owner already has is shown as that agent coming back: the consent card
 *   preselects "keep its current access", and the approval hands the requester the agent's identity,
 *   its grant and a new key. An agent coming back after its token expired holds the private key its
 *   last approval gave it, so it can prove the return: it signs
 *   `aimeat-device-return:v1\n<owner>\n<agent name>\n<signed_at>` with that key and sends
 *   `proof: { signed_at, signature }` (base64 Ed25519) with the request, within five minutes of
 *   signed_at. A proven return keeps the one-press "keep its access" as before. An unproven one is
 *   shown to the owner as a new device taking over the agent, the approval records an account event,
 *   and the owner is offered to sign out the agent's other sessions. Nothing is refused: a machine that
 *   lost its key still reconnects, with the owner seeing what it is.
 *
 *   THE MARK lives one hour as a service-owned record in the owner's namespace,
 *   `agent-device-return.<user code>` (utils/reserved-keys.ts), so no memory route can write it.
 *
 *   ECOSYSTEM APPS (secaudit2026oct26, token-pickup-without-pinned-key-proof). A hello for an app the
 *   owner already connected may carry the same proof, signed with the app's pinned key over
 *   `aimeat-eco-hello:v1\n<owner>\n<app>\n<signed_at>`. The mark is the same record, holding the GEAI,
 *   and GET /v1/ecosystem-apps/pending reports it as `key_proven`.
 * @structure RETURN_PROOF_PREFIX · RETURN_PROOF_MAX_AGE_MS · returnProofMessage · returnProofMessageV2 ·
 *   ecoHelloProofMessage · proofVerifies · ecoHelloProofVerifies · spendReturnProof · markReturnProven ·
 *   returnProven
 * @usage
 *   if (existing && await proofVerifies(existing.publicKey, owner, name, body.proof, Date.now(), nodeId)
 *     && await spendReturnProof(storage, ownerGhii, body.proof)) await markReturnProven(storage, ownerGhii, userCode, gaii);
 * @version-history
 *   v1.1.0 — 2026-10-27 — ecoHelloProofMessage and ecoHelloProofVerifies: an ecosystem app proves a
 *     same-key reconnect with its pinned key (secaudit2026oct26, token-pickup-without-pinned-key-proof).
 *   2026-10-27 — The v2 text names the node (`aimeat-device-return:v2\n<node id>\n<owner>\n<agent>\n<signed_at>`),
 *     so a proof made for another node does not verify here; v1 is still accepted. Every proof is taken
 *     once (spendReturnProof): sent again, the request is shown as a new device, not as the return
 *     (secaudit2026oct26, device-return-proof:return-proof-unbound-to-node-and-request).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import { verify } from '../auth/keypair.js';

/** Where a proven return is marked, by user code. Service-owned (utils/reserved-keys.ts). */
export const RETURN_PROOF_PREFIX = 'agent-device-return.';
/** How old a signed_at may be. */
export const RETURN_PROOF_MAX_AGE_MS = 5 * 60_000;

/**
 * The v1 text an agent signs to prove it is coming back. It names no node, so a proof made for one
 * node verifies on another where the same owner and agent names exist. Still accepted, for the
 * clients that sign it; they move to v2.
 */
export function returnProofMessage(owner: string, agentName: string, signedAt: string): string {
  return `aimeat-device-return:v1\n${owner}\n${agentName}\n${signedAt}`;
}

/**
 * The v2 text: the same, naming the node the request goes to (its node_id, as GET
 * /.well-known/aimeat answers it), so the proof verifies on that node only (secaudit2026oct26).
 */
export function returnProofMessageV2(nodeId: string, owner: string, agentName: string, signedAt: string): string {
  return `aimeat-device-return:v2\n${nodeId}\n${owner}\n${agentName}\n${signedAt}`;
}

/**
 * The exact text an ecosystem app signs with its pinned key when it says hello again for an app the
 * owner already connected (secaudit2026oct26, token-pickup-without-pinned-key-proof).
 */
export function ecoHelloProofMessage(owner: string, app: string, signedAt: string): string {
  return `aimeat-eco-hello:v1\n${owner}\n${app}\n${signedAt}`;
}

/**
 * Shared check: `proof` is `{ signed_at, signature }`, fresh, and signs one of `messagesOf(signed_at)`
 * with `publicKey`, tried in order.
 */
async function signedProofVerifies(publicKey: string | undefined, proof: unknown, messagesOf: (signedAt: string) => string[], now: number): Promise<boolean> {
  if (!publicKey || !proof || typeof proof !== 'object') return false;
  const { signed_at: signedAt, signature } = proof as { signed_at?: unknown; signature?: unknown };
  if (typeof signedAt !== 'string' || typeof signature !== 'string' || signature.length > 200) return false;
  const at = Date.parse(signedAt);
  if (!Number.isFinite(at) || Math.abs(now - at) > RETURN_PROOF_MAX_AGE_MS) return false;
  for (const message of messagesOf(signedAt)) {
    if (await verify(publicKey, message, signature)) return true;
  }
  return false;
}

/**
 * Does `proof` verify against the agent's current public key, and is it fresh? The v2 text naming
 * `nodeId` is tried first, then the v1 text. Never throws.
 */
export async function proofVerifies(publicKey: string | undefined, owner: string, agentName: string, proof: unknown, now = Date.now(), nodeId?: string): Promise<boolean> {
  return signedProofVerifies(publicKey, proof, (at) => [
    ...(nodeId ? [returnProofMessageV2(nodeId, owner, agentName, at)] : []),
    returnProofMessage(owner, agentName, at),
  ], now);
}

/** Does an ecosystem app's hello `proof` verify against `publicKey`, and is it fresh? Never throws. */
export async function ecoHelloProofVerifies(publicKey: string | undefined, owner: string, app: string, proof: unknown, now = Date.now()): Promise<boolean> {
  return signedProofVerifies(publicKey, proof, (at) => [ecoHelloProofMessage(owner, app, at)], now);
}

/** The proofs this process took, by signature, until they could no longer verify. */
const spentHere = new Map<string, number>();

/**
 * Take a verified proof, once: true the first time this signature is presented, false after. A proof
 * sent again (relayed, or read from a process list) is then shown as what it is, a request from
 * somewhere else, not as the agent's return. Held in this process and as a service-owned record in
 * the owner's namespace for as long as the proof is fresh, so another process of the node sees it too.
 */
export async function spendReturnProof(storage: Storage, ownerGhii: string, proof: unknown, now = Date.now()): Promise<boolean> {
  const signature = String((proof as { signature?: unknown } | null)?.signature ?? '');
  const id = createHash('sha256').update(signature).digest('hex').slice(0, 32);
  for (const [k, until] of spentHere) if (until < now) spentHere.delete(k);
  if (spentHere.has(id)) return false;
  spentHere.set(id, now + 2 * RETURN_PROOF_MAX_AGE_MS);
  const at = new Date(now).toISOString();
  const record = {
    key: `${RETURN_PROOF_PREFIX}spent-${id}`, ownerGaii: ownerGhii, value: { spent_at: at }, visibility: 'private' as const,
    tags: ['agent', 'device-return'], ttlHours: 1, version: 1, createdAt: at, updatedAt: at,
  };
  // One conditional insert: of two processes taking the same proof, one wins. Both providers have it;
  // a store without it is held by this process's own record above.
  if (!storage.createMemoryIfAbsent) return true;
  return (await storage.createMemoryIfAbsent(record)) !== null;
}

const markKey = (userCode: string) => `${RETURN_PROOF_PREFIX}${userCode}`;

/** Mark the request with this user code as a proven return of `gaii`. */
export async function markReturnProven(storage: Storage, ownerGhii: string, userCode: string, gaii: string): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: markKey(userCode), ownerGaii: ownerGhii, value: { gaii, proven_at: now }, visibility: 'private',
    tags: ['agent', 'device-return'], ttlHours: 1, version: 1, createdAt: now, updatedAt: now,
  });
}

/** Was the request with this user code proven to come from `gaii` itself? */
export async function returnProven(storage: Storage, ownerGhii: string, userCode: string, gaii: string): Promise<boolean> {
  const rec = await storage.getMemory(ownerGhii, markKey(userCode));
  return (rec?.value as { gaii?: unknown } | undefined)?.gaii === gaii;
}
