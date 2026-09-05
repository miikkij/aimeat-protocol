/**
 * @file src/mcp/resource-events.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The resource change event bus, extracted from mcp/index.ts by pure move. REST routes,
 *   services and MCP tools emit resource change events here, and every open MCP session forwards
 *   them to its subscribers over SSE.
 *
 *   IT IS A LEAF ON PURPOSE. A service that told an agent "your resource changed" had to import
 *   mcp/index.ts, which imports every tool group, and one of those groups imports the service back:
 *   the dependency cruiser found the cycle the day feat/ai-jobs was merged (a job's on_done runs an
 *   extension action, the extension road reaches the data-package store, the store notified MCP
 *   through index.ts). This file imports nothing of the node's own, so anything may notify through
 *   it without reaching the registry. mcp/index.ts re-exports the same names, so no importer had to
 *   change; new code imports from here.
 * @structure resourceEvents · ResourceChangeEvent · emitResourceUpdated(agentGaii, uri) ·
 *   emitResourceListChanged(agentGaii)
 * @usage import { emitResourceUpdated } from '../mcp/resource-events.js';
 * @version-history
 *   v1.0.0 — 2026-09-05 — Extracted from mcp/index.ts (a pure move; the bodies are verbatim).
 */
import { EventEmitter } from 'node:events';

// ── Resource change event bus ──
// Allows REST routes and MCP tools to emit resource change events
// that get forwarded to subscribed MCP sessions via SSE.
export const resourceEvents = new EventEmitter();
// Each concurrent MCP session adds 3 listeners here (resource:updated,
// resource:listChanged and tool:listChanged) and removes them on session close
// (see core.ts onclose). This is intentional per-session fan-out, not a leak, so
// the number of listeners scales with concurrent agents — Node's default cap of 10
// trips a spurious MaxListenersExceededWarning once ~4 agents connect at once.
// 384 = the same headroom for 128 concurrent agents the 256 gave when a session
// took two listeners, while still flagging a genuine leak (e.g. broken onclose
// cleanup) instead of disabling the detector entirely (0).
resourceEvents.setMaxListeners(384);

export interface ResourceChangeEvent {
    agentGaii: string;
    uri: string;
}

export function emitResourceUpdated(agentGaii: string, uri: string): void {
    resourceEvents.emit('resource:updated', { agentGaii, uri } satisfies ResourceChangeEvent);
}

export function emitResourceListChanged(agentGaii: string): void {
    resourceEvents.emit('resource:listChanged', { agentGaii } as { agentGaii: string });
}

/**
 * Tell this agent's open MCP sessions that its tool list is no longer what they hold.
 *
 * WHY IT EXISTS. /v1/mcp registers the tools the agent's scopes allow, so the owner narrowing or
 * widening those scopes changes the list — and until now nothing said so. The client kept the set
 * it read at connect, and the person had to reconnect the connector by hand after every permission
 * change. That is what `notifications/tools/list_changed` is for, and Claude Code, Grok and the
 * other clients that follow the current spec re-read the list when it arrives; a client that
 * ignores it is no worse off than before, because it already held the stale list.
 *
 * Same bus and same shape as the resource notification above, deliberately: one fan-out, one
 * cleanup path in core.ts, and no second way for a session to learn that something changed.
 */
export function emitToolListChanged(agentGaii: string): void {
    resourceEvents.emit('tool:listChanged', { agentGaii } as { agentGaii: string });
}
