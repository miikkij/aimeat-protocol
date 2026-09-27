/**
 * @file src/mcp/catalog/action-scopes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The permission word each ACTION of a grouped tool needs, for the tools whose actions
 *   need different words.
 *
 *   TOOL_SCOPES (scopes.ts) maps one word per tool, and the node offers a tool only to an agent that
 *   holds it. aimeat_app_manage cannot live under one word: its reads (versions, lineage, agent
 *   status) need none, and before it existed an agent with only memory:read was offered the versions
 *   tool and an agent with only the signals words the visitors tools. So the tool is offered to
 *   every agent (it is in SCOPE_EXEMPT_TOOLS with that reason), and its handler asks this table
 *   for the word of the action it was called with, on every interface that runs the handler.
 * @structure TOOL_ACTION_SCOPES · requiredScopeForAction · actionScopeWords
 * @usage
 *   const word = requiredScopeForAction('aimeat_app_manage', 'settings'); // 'app:write'
 * @version-history
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   v1.0.0 — 2026-09-27 — Initial, for aimeat_app_manage.
 */
import { APP_MANAGE_ACTIONS } from './definitions/app-manage.js';

/** tool → action → permission word (null: the action needs none). Built from each tool's own table. */
export const TOOL_ACTION_SCOPES: Record<string, Record<string, string | null>> = {
    aimeat_app_manage: Object.fromEntries(Object.entries(APP_MANAGE_ACTIONS).map(([a, spec]) => [a, spec.scope])),
};

/** The word an action needs; null when it needs none or the tool/action is not in the table. */
export function requiredScopeForAction(tool: string, action: string): string | null {
    return TOOL_ACTION_SCOPES[tool]?.[action] ?? null;
}

/** Every word some action asks for, for the scope-parity gate. */
export function actionScopeWords(): Array<{ tool: string; action: string; word: string }> {
    const out: Array<{ tool: string; action: string; word: string }> = [];
    for (const [tool, actions] of Object.entries(TOOL_ACTION_SCOPES)) {
        for (const [action, word] of Object.entries(actions)) if (word) out.push({ tool, action, word });
    }
    return out;
}
