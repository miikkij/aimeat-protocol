/**
 * @file src/services/chat-instance-write.ts
 * @description Registering a chat session and marking it alive, once, for every surface that can do it.
 *
 *   WHY THIS FILE EXISTS. A chat instance is the row that answers "which chats has this person got
 *   open, and when was each one last used". Three places built that row, and they had drifted:
 *
 *     - `POST /v1/chat-instances` verified the owner's GHII exists before writing; neither MCP path
 *       did, so an agent could leave a session row pointing at a profile that is not there.
 *     - `POST /v1/chat-instances` had no upsert: registering the same platform and app name twice
 *       hit the primary key and surfaced as a 500, while `aimeat_instance_create` returned the
 *       existing row. The id is deterministic, so re-registering is the normal case for a returning
 *       session, and the two doors answered it differently.
 *     - `aimeat_instance_create` stamped `isAnonymous: false` on every row instead of deriving it
 *       from the owner, and returned an existing row without marking it seen.
 *     - The MCP session upsert in src/mcp/index.ts created rows without emitting the `chat` change
 *       event, so a new session appeared in the browser's chat list only after some other event
 *       happened to refresh it.
 *
 *   One capability, one implementation, whatever the interface — CLAUDE.md, Backend.
 * @structure
 *   - ChatInstanceCaller / ChatInstanceInput / ChatInstanceResult — the shared shapes
 *   - registerChatInstance() — validate, verify the GHII, upsert the row, emit the change event
 *   - touchChatInstance() — move lastSeen forward for a session that is still working
 * @usage
 *   const out = await registerChatInstance({ storage, config }, { ownerName }, { platform, appName });
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit step 8): the write behind POST /v1/chat-instances,
 *     aimeat_instance_create and the MCP session upsert.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ChatInstanceRecord } from '../storage/interface.js';
import { buildChatInstanceId } from '../utils/gaii.js';
import { emitChange } from './event-bus.js';

export interface ChatInstanceCaller {
    /**
     * Bare owner name the session belongs to: `req.auth!.owner` on the HTTP side, the owner segment
     * of the agent GAII on the MCP side. Never client-supplied — a chat instance is addressed by an
     * id built from this name, so accepting one from the body would let a caller write another
     * person's list.
     */
    ownerName: string;
    /** The agent that opened the session, when an agent did. Left unset for a browser session. */
    agentGaii?: string;
}

export interface ChatInstanceInput {
    platform: string;
    /** Defaults to `session-<epoch ms>`, which is what an unnamed HTTP registration gets. */
    appName?: string;
    /**
     * An explicit id, for the one caller that cannot use the derived one: MCP session rows have
     * carried the id `mcp-<platform>#<owner>@<node>` since before buildChatInstanceId existed, and
     * every session row in production is addressed by it. Deriving it instead would orphan them all.
     */
    id?: string;
}

export type ChatInstanceResult<T> =
    | { ok: true; value: T }
    | { ok: false; status: number; code: string; message: string };

/**
 * Register a chat session, or hand back the one that is already there.
 *
 * The id is deterministic (platform, app name, owner, node), so a returning session asks for the
 * same row it had. Existing rows are marked seen rather than refused: a second registration means
 * the session is alive again, which is exactly what lastSeen records.
 */
export async function registerChatInstance(
    deps: { storage: Storage; config: AimeatConfig },
    caller: ChatInstanceCaller,
    input: ChatInstanceInput,
): Promise<ChatInstanceResult<{ record: ChatInstanceRecord; created: boolean }>> {
    const { storage, config } = deps;

    if (!input.platform || typeof input.platform !== 'string') {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'platform is required' };
    }

    const appName = input.appName || `session-${Date.now()}`;
    const id = input.id ?? buildChatInstanceId(input.platform, appName, caller.ownerName, config.nodeId);

    const existing = await storage.getChatInstance(id);
    if (existing) {
        const touched = await touchChatInstance({ storage }, id);
        return { ok: true, value: { record: touched ?? existing, created: false } };
    }

    // A session row points at a profile. Without this the row still lists and still answers, and the
    // GHII it names does not exist.
    const ghii = `${caller.ownerName}@${config.nodeId}`;
    const ghiiRecord = await storage.getGHII(ghii);
    if (!ghiiRecord) {
        return { ok: false, status: 404, code: 'GHII_NOT_FOUND', message: `No GHII profile found for "${caller.ownerName}"` };
    }

    const now = new Date().toISOString();
    const record = await storage.createChatInstance({
        id,
        platform: input.platform,
        appName,
        ownerName: caller.ownerName,
        ghii,
        nodeId: config.nodeId,
        isAnonymous: caller.ownerName === 'anonymous',
        ...(caller.agentGaii ? { agentGaii: caller.agentGaii } : {}),
        createdAt: now,
        lastSeen: now,
    });

    // The chat list in the browser listens on this.
    emitChange('chat');

    return { ok: true, value: { record, created: true } };
}

/**
 * Move lastSeen forward for a session that is still working.
 *
 * `notify` is off for the MCP per-request heartbeat: that fires on every tool call, and a `chat`
 * event on each one would have every connected browser re-fetching the list dozens of times a
 * minute. An explicit heartbeat from a client is a single deliberate call, so it notifies.
 */
export async function touchChatInstance(
    deps: { storage: Storage },
    id: string,
    opts: { notify?: boolean } = {},
): Promise<ChatInstanceRecord | null> {
    const updated = await deps.storage.updateChatInstance(id, { lastSeen: new Date().toISOString() });
    if (opts.notify !== false) emitChange('chat');
    return updated;
}
