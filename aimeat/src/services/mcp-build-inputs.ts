/**
 * @file src/services/mcp-build-inputs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The values an MCP server reads from storage when it is built: the owner's
 *   proactive guidance (services/proactive-mode.ts), the node that answers support here
 *   (resolveSupportRoute in services/message-alias.ts, over the stored peer rows) and the owner's
 *   context index (services/context/index-line.ts). All go into the instructions.
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
 *   v1.1.0 — 2026-11-08 — The owner's context index, for a session that reads memory, cached per
 *     owner and reader kind on the 2026-07-28 path like the guidance.
 *   v1.0.0 — 2026-10-20 — Moved out of createMcpServer (mcp/index.ts), plus the cache for the
 *     2026-07-28 path (MCP SDK v2 migration step 5).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { proactiveGuidance } from './proactive-mode.js';
import { resolveSupportRoute } from './message-alias.js';
import { contextIndexLine } from './context/index-line.js';
import type { ContentReader } from './classification/reader.js';

export interface BuildInputs { guidance: string | null; supportAnsweredBy: string | null; contexts: string | null }

/**
 * Who is connecting, for the context index: `readsMemory` is false for a session whose scopes
 * hold no memory:read, which then gets no index (it could open none of them); `agentSession`
 * hides the contexts the owner keeps private from an agent.
 */
export interface BuildReader {
    readsMemory: boolean;
    agentSession: boolean;
    /** The connecting principal, whose classification reader filters the index (one cache entry each). */
    identity?: string;
    /** That principal's classification reader (services/classification/reader.ts). */
    content?: ContentReader;
}

// process-local: a second process builds its own index for a connecting session, from the same
// storage, at most BUILD_INPUTS_TTL_MS apart; nothing is lost, as with guidanceByOwner.
const contextsByReader = new Map<string, { at: number; value: string | null }>();

async function readContexts(storage: Storage, config: AimeatConfig, owner: string | undefined, reader: BuildReader, cached: boolean, now: number): Promise<string | null> {
    if (!owner || !reader.readsMemory) return null;
    if (!cached) return contextIndexLine(storage, config, owner, reader.agentSession, now, reader.content);
    // Per principal, because each has its own classification reader and its own scopes.
    const k = `${owner}\u0000${reader.identity ?? ''}\u0000${reader.agentSession ? 'a' : 'o'}`;
    const hit = contextsByReader.get(k);
    if (hit && now - hit.at < BUILD_INPUTS_TTL_MS) return hit.value;
    const value = await contextIndexLine(storage, config, owner, reader.agentSession, now, reader.content);
    contextsByReader.set(k, { at: now, value });
    if (contextsByReader.size > 10_000) {
        for (const [key, v] of contextsByReader) if (now - v.at >= BUILD_INPUTS_TTL_MS) contextsByReader.delete(key);
    }
    return value;
}

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
export async function readBuildInputs(storage: Storage, config: AimeatConfig, owner: string | undefined, cached: boolean, now = Date.now(), reader: BuildReader = { readsMemory: false, agentSession: true }): Promise<BuildInputs> {
    const contexts = await readContexts(storage, config, owner, reader, cached, now);
    if (!cached) {
        return { guidance: await proactiveGuidance(storage, config, owner), supportAnsweredBy: await readSupportAnsweredBy(storage), contexts };
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
    return { guidance, supportAnsweredBy: supportRoute.value, contexts };
}

/** Forget every cached value (tests). */
export function clearBuildInputs(): void {
    guidanceByOwner.clear();
    contextsByReader.clear();
    supportRoute = undefined;
}
