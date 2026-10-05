/**
 * @file src/mcp/workspace-documents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two MCP tools that edit a workspace DOCUMENT in place: append markdown, and
 *   replace one section. Registered from mcp/workspaces.ts, which is at the max-file-lines boundary.
 *
 *   THESE HOLD NO LOGIC OF THEIR OWN. services/workspace-doc-edit.ts is what the REST routes call
 *   too, so the manifest gate, the access rule, the archive guard, the schema check, the ceilings
 *   and the compare-and-swap retry cannot answer differently on one door than on the other.
 * @structure registerWorkspaceDocumentTools(mcp, deps, caller)
 * @usage registerWorkspaceDocumentTools(mcp, { storage, config }, caller);
 * @version-history
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9). The deps no longer carry agentGaii and ownerName.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-09-02 — Initial (wish-workspace-append-ja-osiomuokkaus).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import {
    appendToDocument, replaceDocumentSection, WorkspaceDocError,
    type DocEditCaller, type DocEditResult,
} from '../services/workspace-doc-edit.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export interface WorkspaceDocToolDeps {
    storage: Storage;
    config: AimeatConfig;
}

export function registerWorkspaceDocumentTools(
    mcp: McpServer, deps: WorkspaceDocToolDeps,
    /** The session's caller (services/caller-context.ts): its principal is the session subject the
     *  shared access rule decides on. */
    caller: () => CallerContext,
): void {
    const { storage, config } = deps;
    const editDeps = { storage, config };

    const fail = (msg: string): TextResult => ({ content: [{ type: 'text', text: msg }], isError: true });
    const editCaller = (): DocEditCaller => caller().principalView;

    /** The same answer shape from both tools, and the same rendering of a refusal. */
    const ok = (r: DocEditResult): TextResult => ({
        content: [{
            type: 'text',
            text: JSON.stringify({
                written: r.key, id: r.id, space: r.space, version: r.version, bytes: r.bytes,
                ...(r.section ? { section: r.section } : {}),
                ...(r.seededFromPublished ? { seeded_from_published: true } : {}),
                ...(r.attempts > 1 ? { attempts: r.attempts } : {}),
                note: 'The DRAFT changed. Publish it with aimeat_workspace_publish when it is ready.',
            }, null, 2),
        }],
    });
    const editFail = (err: unknown): TextResult => {
        if (err instanceof WorkspaceDocError) return fail(`${err.code}: ${err.message}`);
        throw err;
    };

    mcp.tool('aimeat_workspace_doc_append', descriptionFor('aimeat_workspace_doc_append'),
        zodShapeFor('aimeat_workspace_doc_append'),
        annotationsFor('aimeat_workspace_doc_append'),
        async ({ organism_id, ws, space, id, markdown, section }): Promise<TextResult> => {
            try {
                return ok(await appendToDocument(editDeps, editCaller(), {
                    organismId: organism_id, wsId: ws, space, id, markdown,
                    ...(section ? { section } : {}),
                    pipeline: 'mcp.workspace_doc_append',
                }));
            } catch (err) { return editFail(err); }
        });

    mcp.tool('aimeat_workspace_doc_section_replace', descriptionFor('aimeat_workspace_doc_section_replace'),
        zodShapeFor('aimeat_workspace_doc_section_replace'),
        annotationsFor('aimeat_workspace_doc_section_replace'),
        async ({ organism_id, ws, space, id, section, markdown }): Promise<TextResult> => {
            try {
                return ok(await replaceDocumentSection(editDeps, editCaller(), {
                    organismId: organism_id, wsId: ws, space, id, section, markdown,
                    pipeline: 'mcp.workspace_doc_section',
                }));
            } catch (err) { return editFail(err); }
        });
}
