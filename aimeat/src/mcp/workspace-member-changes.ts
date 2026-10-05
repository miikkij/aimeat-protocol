/**
 * @file src/mcp/workspace-member-changes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tools through which a workspace member adds a space, changes the sections of
 *   a document space, and through which the workspace's creator or an admin decides a member's
 *   suggestion: aimeat_workspace_space_add, aimeat_workspace_sections_set, aimeat_workspace_suggestions.
 *   Registered from mcp/workspaces.ts, which is at the max-file-lines boundary.
 *
 *   THESE HOLD NO LOGIC OF THEIR OWN. services/workspace-member-changes.ts and
 *   services/workspace-suggestions.ts are what the REST routes call too, so who may change a
 *   workspace, whether the change lands at once or waits for an approval, and who may decide one
 *   cannot answer differently here than on the web page. An MCP session is always an agent, so a
 *   person deciding from their own chat decides through the agent their chat is, and the service
 *   checks that the agent holds the permission the change needs.
 * @structure registerWorkspaceMemberChangeTools(mcp, deps)
 * @usage registerWorkspaceMemberChangeTools(mcp, { storage, config, agentGaii, ownerName });
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-09-25 — Initial: the member change doors (workspace actions for plain members).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toolError } from './tool-error.js';
import { addWorkspaceSpaces, setWorkspaceSections, isRefusal, type ChangeCaller } from '../services/workspace-member-changes.js';
import { listSuggestions, decideSuggestion } from '../services/workspace-suggestions.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export interface WorkspaceMemberChangeToolDeps {
    storage: Storage;
    config: AimeatConfig;
    /** The session subject: the agent GAII the rules decide on. */
    agentGaii: string;
    ownerName: string;
}

/** Parse a possibly-JSON-stringified param (some clients stringify object and array params). */
function parsed(v: unknown): unknown {
    // eslint-disable-next-line aimeat/no-silent-catch -- a value that is not JSON stays as it came and the service says why
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { /* not JSON: the service refuses it by name */ } }
    return v;
}

export function registerWorkspaceMemberChangeTools(mcp: McpServer, deps: WorkspaceMemberChangeToolDeps): void {
    const { storage, config, agentGaii, ownerName } = deps;
    const svc = { storage, config };
    const caller = (): ChangeCaller => ({ principal: agentGaii, owner: ownerName, roles: ['agent'] });
    const ok = (obj: unknown): TextResult => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

    mcp.tool('aimeat_workspace_space_add', descriptionFor('aimeat_workspace_space_add'),
        zodShapeFor('aimeat_workspace_space_add'),
        annotationsFor('aimeat_workspace_space_add'),
        async ({ organism_id, ws, spaces, schemas }): Promise<TextResult> => {
            const r = await addWorkspaceSpaces(svc, caller(), { orgId: organism_id, ws, spaces: parsed(spaces), schemas: parsed(schemas) });
            return isRefusal(r) ? toolError(r.code, r.message) : ok(r);
        });

    mcp.tool('aimeat_workspace_sections_set', descriptionFor('aimeat_workspace_sections_set'),
        zodShapeFor('aimeat_workspace_sections_set'),
        annotationsFor('aimeat_workspace_sections_set'),
        async ({ organism_id, ws, space, sections }): Promise<TextResult> => {
            const r = await setWorkspaceSections(svc, caller(), { orgId: organism_id, ws, space, sections: parsed(sections) });
            return isRefusal(r) ? toolError(r.code, r.message) : ok(r);
        });

    mcp.tool('aimeat_workspace_suggestions', descriptionFor('aimeat_workspace_suggestions'),
        zodShapeFor('aimeat_workspace_suggestions'),
        annotationsFor('aimeat_workspace_suggestions'),
        async ({ organism_id, action, ws, status, suggestion_id, decision, note }): Promise<TextResult> => {
            if (action === 'list') {
                const r = await listSuggestions(svc, caller(), { orgId: organism_id, ws, status });
                return isRefusal(r) ? toolError(r.code, r.message) : ok(r);
            }
            if (!suggestion_id) return toolError('INVALID_INPUT', "action='decide' needs a suggestion_id: list them with action='list'.");
            const r = await decideSuggestion(svc, caller(), { orgId: organism_id, id: suggestion_id, decision, note });
            return isRefusal(r) ? toolError(r.code, r.message) : ok(r);
        });
}
