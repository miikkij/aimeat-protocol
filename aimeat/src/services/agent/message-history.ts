/**
 * @file src/services/agent/message-history.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading an agent's message history: who may read it and the paged read. GET
 *   /v1/agents/:name/messages and aimeat_message_history both call it, so the gate and the read are
 *   written once (structure programme 2026-11, unit 2b). Each surface reads its own paging input: the
 *   route clamps per_page to 1..100 and the tool passes it as given, a difference the programme lists
 *   for the developer to decide.
 *
 *   WHO. The agent itself, or its owner in person (mayActOnAgent, utils/gaii.ts; QA audit 2026-10-14,
 *   K1). An MCP session is the agent itself, so the tool always passes the gate.
 * @structure messageHistoryFor(deps, auth, agentGaii, query) → { messages, total } | refusal
 * @usage
 *   const read = await messageHistoryFor({ storage, config }, req.auth, agentGaii, { page, perPage });
 *   if (!read.ok) refuse();
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/agent-messages.ts and mcp/agent-messages.ts, which each held
 *     the read (structure programme 2026-11, unit 2b).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { mayActOnAgent } from '../../utils/gaii.js';

type Deps = { storage: Storage; config: Pick<AimeatConfig, 'nodeId'> };
type Query = Parameters<Storage['listMessages']>[1];
type Page = Awaited<ReturnType<Storage['listMessages']>>;

/** One page of the agent's messages, when the caller may read them. */
export async function messageHistoryFor(
    deps: Deps, auth: Parameters<typeof mayActOnAgent>[0], agentGaii: string, query: Query,
): Promise<({ ok: true } & Page) | { ok: false; code: 'NOT_YOURS' }> {
    if (!mayActOnAgent(auth, agentGaii, deps.config.nodeId)) return { ok: false, code: 'NOT_YOURS' };
    const page = await deps.storage.listMessages(agentGaii, query);
    return { ok: true, ...page };
}
