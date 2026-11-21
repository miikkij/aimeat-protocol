/**
 * @file scripts/lib/sandbox-identity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the node answering at a sandbox's recorded address is that sandbox.
 *
 *   WHY. `pnpm sandbox --status` asked only whether /v1/spec answered on the port .sandbox.json
 *   records. When this sandbox had stopped and another worktree's sandbox later took the port, it
 *   said UP for the other node, and the reuse branch asked that node for tokens it could not sign
 *   ("Invalid signature"; docs/pitfalls.md §77b until 2026-11-21). A node's public key
 *   (/.well-known/aimeat) lives in its own database, so another node's key differs.
 * @structure nodeKeyOf(baseUrl) · sandboxIdentity(baseUrl, recordedKey)
 * @usage const state = await sandboxIdentity(s.baseUrl, s.nodeKey);   // 'ours' | 'other' | 'down'
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */

/** The node's published public key; null when nothing answers or it publishes none. */
export async function nodeKeyOf(baseUrl: string): Promise<string | null> {
    try {
        const res = await fetch(`${baseUrl}/.well-known/aimeat`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return null;
        const body = await res.json() as { public_key?: string; data?: { public_key?: string } };
        return body.public_key ?? body.data?.public_key ?? null;
    } catch { return null; }
}

async function answers(baseUrl: string): Promise<boolean> {
    try {
        const res = await fetch(`${baseUrl}/v1/spec`, { signal: AbortSignal.timeout(2000) });
        return res.ok;
    } catch { return false; }
}

/**
 * 'down' when nothing answers; 'other' when a node answers with a key that is not `recordedKey`;
 * 'ours' otherwise. A state written before keys were recorded (no `recordedKey`) counts as ours,
 * and the token refresh that follows is what tells.
 */
export async function sandboxIdentity(baseUrl: string, recordedKey: string | undefined): Promise<'ours' | 'other' | 'down'> {
    if (!await answers(baseUrl)) return 'down';
    if (!recordedKey) return 'ours';
    return (await nodeKeyOf(baseUrl)) === recordedKey ? 'ours' : 'other';
}
