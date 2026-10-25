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
 * @structure RETURN_PROOF_PREFIX · RETURN_PROOF_MAX_AGE_MS · returnProofMessage · proofVerifies ·
 *   markReturnProven · returnProven
 * @usage
 *   if (existing && await proofVerifies(existing.publicKey, owner, name, body.proof)) await markReturnProven(storage, ownerGhii, userCode, gaii);
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import type { Storage } from '../storage/interface.js';
import { verify } from '../auth/keypair.js';

/** Where a proven return is marked, by user code. Service-owned (utils/reserved-keys.ts). */
export const RETURN_PROOF_PREFIX = 'agent-device-return.';
/** How old a signed_at may be. */
export const RETURN_PROOF_MAX_AGE_MS = 5 * 60_000;

/** The exact text an agent signs to prove it is coming back. */
export function returnProofMessage(owner: string, agentName: string, signedAt: string): string {
  return `aimeat-device-return:v1\n${owner}\n${agentName}\n${signedAt}`;
}

/** Does `proof` verify against the agent's current public key, and is it fresh? Never throws. */
export async function proofVerifies(publicKey: string | undefined, owner: string, agentName: string, proof: unknown, now = Date.now()): Promise<boolean> {
  if (!publicKey || !proof || typeof proof !== 'object') return false;
  const { signed_at: signedAt, signature } = proof as { signed_at?: unknown; signature?: unknown };
  if (typeof signedAt !== 'string' || typeof signature !== 'string' || signature.length > 200) return false;
  const at = Date.parse(signedAt);
  if (!Number.isFinite(at) || Math.abs(now - at) > RETURN_PROOF_MAX_AGE_MS) return false;
  return verify(publicKey, returnProofMessage(owner, agentName, signedAt), signature);
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
