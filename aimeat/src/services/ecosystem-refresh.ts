/**
 * @file src/services/ecosystem-refresh.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rule an ecosystem app's (GEAI) refresh at POST /v1/auth/refresh answers to.
 *
 *   THE PINNED KEY IS CHECKED. An ecosystem app sends its Ed25519 public key at hello, and the owner's
 *   approval pins it on the app record. Until 2026-10-09 nothing ever verified a signature with it:
 *   the refresh took the bearer alone, so a stolen ninety-day credential renewed itself without end
 *   and the pin protected nothing (secrets audit 2026-10-09, S-2). A refresh now carries a fresh
 *   signature by the pinned key over `<geai><timestamp>`, the same message and the same five-minute
 *   window the agent renewal at POST /v1/auth/token uses, and a signature is spent once per process.
 *
 *   THE CHAIN ENDS. The token minted at approval carries `auth_time`, the moment the owner said yes,
 *   and every refresh copies it forward. Once ECO_REAPPROVAL_SECONDS (365 days) have passed since
 *   then, the refresh is refused and the app says hello again, so the owner sees the app and its
 *   permissions at least once a year. A renewed token never outlives its chain. A token minted before
 *   `auth_time` existed starts its chain at its own issue time, so an app approved before this change
 *   keeps working until its next refresh, and from then on answers to the same rule.
 * @structure ECO_REAPPROVAL_SECONDS · ecoProofMessage · EcoRefreshDecision · ecosystemRefreshDecision
 * @usage const d = await ecosystemRefreshDecision({ geai, publicKey, authTime, iat, timestamp, signature, now, maxChainSeconds, ttlSeconds });
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, S-2).
 */
import { verify } from '../auth/keypair.js';
import { signatureTimestampFresh, spendSignature } from '../auth/signed-request.js';

/**
 * How long an owner's approval of an ecosystem app carries its refreshes: one year. An app that runs
 * unattended for a year is shown to its owner again, with the permissions it holds, before it goes on.
 */
export const ECO_REAPPROVAL_SECONDS = 365 * 86_400;

/** The message an ecosystem app signs with its pinned key to refresh: its GEAI, then the timestamp. */
export const ecoProofMessage = (geai: string, timestamp: string): string => geai + timestamp;

export type EcoRefreshDecision =
  | { ok: true; authTime: number; chainEndsAt: number; ttlSeconds: number }
  | { ok: false; status: 401; code: 'ECO_KEY_PROOF_REQUIRED' | 'ECO_KEY_PROOF_INVALID' | 'ECO_REAPPROVAL_REQUIRED'; message: string };

/**
 * May this refresh go ahead, and for how long is the new token good? Checks the proof first and the
 * chain second, so a caller without the key learns nothing about the chain.
 */
export async function ecosystemRefreshDecision(input: {
  geai: string;
  /** The key pinned on the app record at approval. */
  publicKey: string;
  /** `auth_time` of the presented token, when it carries one. */
  authTime?: number;
  /** `iat` of the presented token: the chain start of a token minted before `auth_time` existed. */
  iat?: number;
  timestamp?: unknown;
  signature?: unknown;
  now: Date;
  maxChainSeconds: number;
  /** The lifetime a renewed token would have without the chain's end. */
  ttlSeconds: number;
}): Promise<EcoRefreshDecision> {
  const { geai, publicKey, timestamp, signature, now } = input;
  if (typeof timestamp !== 'string' || !timestamp || typeof signature !== 'string' || !signature) {
    return {
      ok: false, status: 401, code: 'ECO_KEY_PROOF_REQUIRED',
      message: 'An ecosystem app renews its access by proving it still holds the key it connected with. '
        + 'Send { timestamp, signature } in the body: timestamp is the current time (ISO 8601), and signature is '
        + 'the base64 Ed25519 signature of your GEAI followed by that timestamp, made with the private half of the '
        + 'public_key you sent at hello.',
    };
  }
  const valid = signatureTimestampFresh(timestamp)
    && await verify(publicKey, ecoProofMessage(geai, timestamp), signature)
    && spendSignature(signature);
  if (!valid) {
    return {
      ok: false, status: 401, code: 'ECO_KEY_PROOF_INVALID',
      message: 'The signature does not prove the key this app connected with, or its timestamp is more than five '
        + 'minutes from now, or it was already used. Sign your GEAI followed by a fresh timestamp with the private '
        + 'half of the public_key you sent at hello. An app whose key is lost connects again with POST '
        + '/v1/ecosystem-apps/hello, and its owner approves it again.',
    };
  }
  const nowS = Math.floor(now.getTime() / 1000);
  const authTime = typeof input.authTime === 'number' ? input.authTime : (input.iat ?? nowS);
  const chainEndsAt = authTime + input.maxChainSeconds;
  if (chainEndsAt <= nowS) {
    return {
      ok: false, status: 401, code: 'ECO_REAPPROVAL_REQUIRED',
      message: 'The owner approved this app more than a year ago, and an approval carries its renewals for one year. '
        + 'Connect again with POST /v1/ecosystem-apps/hello; the owner then sees the app and its permissions and '
        + 'approves it again.',
    };
  }
  return { ok: true, authTime, chainEndsAt, ttlSeconds: Math.min(input.ttlSeconds, chainEndsAt - nowS) };
}
