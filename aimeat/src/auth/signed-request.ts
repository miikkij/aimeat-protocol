/**
 * @file src/auth/signed-request.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two questions a key-signed request has to answer beyond "is the signature
 *   valid": is it RECENT, and has it been used before.
 *
 *   WHY IT EXISTS. A signature over `gaii + nodeId + timestamp` proves the holder of the private
 *   key produced it. It does not prove they produced it just now, and it does not stop anyone else
 *   from sending the same bytes again. `GET /v1/mcp/authorize` took that signature in a QUERY
 *   STRING, verified it, and minted an authorization code — with no comparison of the timestamp to
 *   now and nothing spending it. A query string lands in the node's access log, every proxy in
 *   front of it, the browser's history and the Referer header of whatever the redirect reaches, so
 *   the credential-minting request was, in effect, published and reusable forever. Found by the
 *   2026-09-06 review as item 2.3.
 *
 *   The comparable door (`routes/auth.ts`) had the freshness half written out inline, twice, and
 *   the same five-minute number appears at a third. One number with one meaning lives here now.
 *
 *   FRESHNESS AND SPEND ARE DIFFERENT GUARANTEES and both are needed. Freshness bounds how long a
 *   captured signature is worth anything; the spend makes it worth nothing after its first use. A
 *   window alone still leaves five minutes of replay from a log tail, which is plenty.
 * @structure
 *   - SIGNATURE_WINDOW_MS — how far from now a signed timestamp may sit, in either direction
 *   - signatureTimestampFresh(timestamp) — the freshness half
 *   - spendSignature(signature) — the single-use half; true the first time, false ever after
 * @usage
 *   if (!signatureTimestampFresh(timestamp)) return refuse('Timestamp too old or too far in the future');
 *   if (!await spendSignature(signature)) return refuse('That signature has already been used');
 * @version-history
 *   v1.1.0 — 2026-11-04 — spendSignature spends in the node's storage, so a signature spent on one
 *     process is refused on another; resetSpentSignatures is removed, nothing called it (codebase
 *     analysis 2026-11-03, HA stage 2).
 *   v1.0.0 — 2026-09-06 — Written for review item 2.3: a replayable signature in a GET query string.
 */
import { spendOnce } from '../services/ephemeral-claims.js';

/**
 * How far from now a signed timestamp may sit, in either direction.
 *
 * Both directions on purpose: a clock ahead of ours is as much a sign of a manufactured timestamp
 * as one behind, and accepting the future would let a signature be minted today for use next week.
 */
export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

/** Is a signed ISO timestamp close enough to now to have been produced for this request? */
export function signatureTimestampFresh(timestamp: string, windowMs = SIGNATURE_WINDOW_MS): boolean {
    const ts = new Date(timestamp).getTime();
    if (Number.isNaN(ts)) return false;
    return Math.abs(Date.now() - ts) <= windowMs;
}

/**
 * Claim a signature. True the first time it is seen, false every time after, on every process of the
 * node: the spend is a row in the node's storage (services/ephemeral-claims.ts, kind 'signature'), as
 * the OAuth authorization codes beside it are. Until 2026-11-04 both were Maps in one process, and
 * this comment said they were one decision; they moved together.
 *
 * A spend only has to outlive the freshness window: past it the timestamp check refuses on its own,
 * so nothing is gained by remembering longer.
 */
export function spendSignature(signature: string, windowMs = SIGNATURE_WINDOW_MS): Promise<boolean> {
    const now = Date.now();
    return spendOnce('signature', String(signature), now + windowMs, now);
}
