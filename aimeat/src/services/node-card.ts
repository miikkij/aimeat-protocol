/**
 * @file services/node-card.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Read another node's card (GET /.well-known/aimeat): the node id and the public key it
 *   publishes about itself.
 *
 *   WHAT A CARD PROVES, AND WHAT IT DOES NOT. A card read from a url proves that the server at that
 *   url says it is node X with key K, now. It does not prove that the url is node X's: node ids have
 *   no authority outside each node's own peer table, so whoever names the url can serve any card
 *   there, the real node's key included. A caller uses it to refuse what cannot be true (a key the
 *   url does not publish, a url that is another node), never as proof of whose name the id is.
 *
 *   Every read goes through safeFetch (the url is the caller's word) and holds its cap while the
 *   body arrives, the rules package-pull.ts follows for the same read.
 * @structure NodeCardRead · readNodeCard(url, timeoutMs)
 * @usage
 *   const card = await readNodeCard(url, config.federationTimeoutMs);
 *   if (card.ok && card.nodeId === nodeId && card.publicKey === key) ...
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial, for proving a packages-only peer before it is registered (the
 *     peer-registration incident, finding F of docs/specs/package-sale-design.md).
 */
import { safeFetch, stripTrailingSlashes, validateOutboundUrl } from '../utils/url-validator.js';
import { readBodyCapped } from '../utils/read-capped.js';

/** The most a node card may be: a few hundred bytes of identity and key in the standard envelope. */
const MAX_NODE_CARD_BYTES = 64 * 1024;

export type NodeCardRead =
    | { ok: true; nodeId: string; publicKey: string }
    /** The url is not one this node may reach (a private address on a public node, a bad scheme). */
    | { ok: false; reason: 'blocked'; detail: string }
    /** Nothing usable answered: down, a timeout, an error status, or a body that is not a card. */
    | { ok: false; reason: 'unreachable'; detail: string };

/** The card the server at `url` publishes. Never throws. */
export async function readNodeCard(url: string, timeoutMs: number): Promise<NodeCardRead> {
    const base = stripTrailingSlashes(url);
    const check = await validateOutboundUrl(base);
    if (!check.valid) return { ok: false, reason: 'blocked', detail: check.reason ?? 'The address is not allowed.' };
    let res: Response;
    try {
        res = await safeFetch(`${base}/.well-known/aimeat`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
        return { ok: false, reason: 'unreachable', detail: String(err).slice(0, 200) };
    }
    if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);   // eslint-disable-line aimeat/no-silent-catch -- the status is the answer; the body is only released
        return { ok: false, reason: 'unreachable', detail: `HTTP ${res.status}` };
    }
    const raw = await readBodyCapped(res, MAX_NODE_CARD_BYTES);
    if (!raw) return { ok: false, reason: 'unreachable', detail: 'The card is larger than a card can be.' };
    let body: { data?: { node_id?: unknown; public_key?: unknown } } | null;
    try { body = JSON.parse(raw.toString('utf8')); } catch (err) {
        return { ok: false, reason: 'unreachable', detail: `The card is not JSON: ${String(err).slice(0, 120)}` };
    }
    const nodeId = body?.data?.node_id;
    const publicKey = body?.data?.public_key;
    if (typeof nodeId !== 'string' || !nodeId || typeof publicKey !== 'string' || !publicKey) {
        return { ok: false, reason: 'unreachable', detail: 'The answer carries no node id and key.' };
    }
    return { ok: true, nodeId, publicKey };
}
