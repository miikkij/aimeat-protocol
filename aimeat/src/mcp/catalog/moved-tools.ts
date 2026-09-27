/**
 * @file src/mcp/catalog/moved-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools that were replaced by an action of another tool, and the answer a call to
 *   an old name gets: which tool and action to call instead, and how the old fields map.
 *
 *   WHY. On 2026-09-27 ten app tools became actions of aimeat_app_manage. An agent, a skill, a saved
 *   prompt, a schedule or a workflow that still names an old tool got "Tool X not found" and no way
 *   to continue. The old names stay out of tools/list, so the list does not grow back; a call to one
 *   is answered with TOOL_MOVED and the exact call that replaces it. The node MCP server and the
 *   connector answer it from their tools/call handler (mcp/moved-tools-answer.ts); the CLI dispatch,
 *   /local/call and aimeat_invoke answer it where they would say the tool is unknown.
 * @structure MOVED_TOOLS · movedToolMessage
 * @usage const moved = movedToolMessage(name); if (moved) return toolError('TOOL_MOVED', moved);
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the ten tools aimeat_app_manage replaced.
 */
import { APP_MANAGE_ACTIONS } from './definitions/app-manage.js';

/** Old tool name → the tool and action that replace it, and anything about the fields that changed. */
export const MOVED_TOOLS: Record<string, { tool: string; action: string; fields?: string }> = {
    aimeat_app_versions: { tool: 'aimeat_app_manage', action: 'versions', fields: '`owner` is now optional and means your own account when you leave it out.' },
    aimeat_app_screenshot: { tool: 'aimeat_app_manage', action: 'screenshot' },
    aimeat_app_seo_set: { tool: 'aimeat_app_manage', action: 'seo' },
    aimeat_app_marks_set: { tool: 'aimeat_app_manage', action: 'marks' },
    aimeat_app_legal_set: { tool: 'aimeat_app_manage', action: 'legal' },
    aimeat_app_audit: { tool: 'aimeat_app_manage', action: 'audit' },
    aimeat_app_visitors: { tool: 'aimeat_app_manage', action: 'visitors' },
    aimeat_app_visitors_measure: { tool: 'aimeat_app_manage', action: 'visitors_measure' },
    aimeat_app_ui_get: { tool: 'aimeat_app_manage', action: 'ui_get' },
    aimeat_app_ui_set: { tool: 'aimeat_app_manage', action: 'ui_set' },
};

/**
 * The answer to a call to an old name, without the code (each surface adds `TOOL_MOVED: ` in its own
 * way), or null when the name did not move.
 */
export function movedToolMessage(name: string): string | null {
    const moved = MOVED_TOOLS[name];
    if (!moved) return null;
    const spec = APP_MANAGE_ACTIONS[moved.action];
    const fields = spec ? Object.keys(spec.fields) : [];
    if (spec?.provenance) fields.push('ai_provenance', 'ai_provenance_id');
    const call = `${moved.tool} { action: "${moved.action}"${fields.length ? `, ${fields.join(', ')}` : ''} }`;
    return `${name} was replaced on 2026-09-27. Call ${moved.tool} with action "${moved.action}": ${call}. `
        + `The fields keep their names and meaning.${moved.fields ? ` ${moved.fields}` : ''} Nothing was changed by this call.`;
}
