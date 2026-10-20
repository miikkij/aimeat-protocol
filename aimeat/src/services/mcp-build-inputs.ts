/**
 * @file src/services/mcp-build-inputs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two values an MCP server reads from storage when it is built: the owner's
 *   proactive guidance (services/proactive-mode.ts) and the node that answers support here
 *   (resolveSupportRoute in services/message-alias.ts, over the stored peer rows). Both go into the
 *   instructions.
 *
 *   CACHED FOR THE 2026-07-28 CODE PATH ONLY. A 2025 session builds its server once, at `initialize`,
 *   and reads both fresh, as it always did. A 2026-07-28 request builds a server per request, so it
 *   reads them through a short cache: per owner for the guidance, node-wide for the support route
 *   (decision 2026-10-20, MCP migration plan item 5). A changed setting reaches a modern client within
 *   BUILD_INPUTS_TTL_MS.
 *
 *   NEVER FAILS A BUILD. proactiveGuidance() answers null on any trouble, and an unreadable peer list
 *   means the instructions say what they always said.
 * @structure readBuildInputs(storage, config, owner, cached) · BUILD_INPUTS_TTL_MS · clearBuildInputs()
 * @version-history
 *   v1.0.0 — 2026-10-20 — Moved out of createMcpServer (mcp/index.ts), plus the cache for the
 *     2026-07-28 path (MCP SDK v2 migration step 5).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { proactiveGuidance } from './proactive-mode.js';
import { resolveSupportRoute } from './message-alias.js';

export interface BuildInputs { guidance: string | null; supportAnsweredBy: string | null }

/** How long a modern request reuses the two values. */
export const BUILD_INPUTS_TTL_MS = 30_000;

const guidanceByOwner = new Map<string, { at: number; value: string | null }>();
let supportRoute: { at: number; value: string | null } | undefined;

async function readSupportAnsweredBy(storage: Storage): Promise<string | null> {
    // Through the SAME resolver the send path uses, so the sentence an agent is told and the address
    // its message actually takes cannot disagree.
    return storage.listFederationPeers()
        .then(rows => {
            const route = resolveSupportRoute(rows);
            return route.kind === 'upstream' ? route.nodeId : null;
        })
        .catch(err => { logger.warn('mcp: support routing unread, instructions unchanged', { error: String(err) }); return null; });
}

/** The guidance and the support route for one build; `cached` for the 2026-07-28 path. */
export async function readBuildInputs(storage: Storage, config: AimeatConfig, owner: string | undefined, cached: boolean, now = Date.now()): Promise<BuildInputs> {
    if (!cached) {
        return { guidance: await proactiveGuidance(storage, config, owner), supportAnsweredBy: await readSupportAnsweredBy(storage) };
    }
    let guidance: string | null;
    const hit = owner ? guidanceByOwner.get(owner) : undefined;
    if (hit && now - hit.at < BUILD_INPUTS_TTL_MS) {
        guidance = hit.value;
    } else {
        guidance = await proactiveGuidance(storage, config, owner);
        if (owner) {
            guidanceByOwner.set(owner, { at: now, value: guidance });
            // Bounded: an entry older than the TTL is worth nothing.
            if (guidanceByOwner.size > 10_000) {
                for (const [k, v] of guidanceByOwner) if (now - v.at >= BUILD_INPUTS_TTL_MS) guidanceByOwner.delete(k);
            }
        }
    }
    if (!supportRoute || now - supportRoute.at >= BUILD_INPUTS_TTL_MS) {
        supportRoute = { at: now, value: await readSupportAnsweredBy(storage) };
    }
    return { guidance, supportAnsweredBy: supportRoute.value };
}

/** Forget every cached value (tests). */
export function clearBuildInputs(): void {
    guidanceByOwner.clear();
    supportRoute = undefined;
}
