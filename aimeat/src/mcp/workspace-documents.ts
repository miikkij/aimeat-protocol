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
 * @structure registerWorkspaceDocumentTools(mcp, deps)
 * @usage registerWorkspaceDocumentTools(mcp, { storage, config, agentGaii, ownerName });
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (wish-workspace-append-ja-osiomuokkaus).
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import {
    appendToDocument, replaceDocumentSection, WorkspaceDocError,
    type DocEditCaller, type DocEditResult,
} from '../services/workspace-doc-edit.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export interface WorkspaceDocToolDeps {
    storage: Storage;
    config: AimeatConfig;
    /** The session subject, which is what the shared access rule decides on. */
    agentGaii: string;
    ownerName: string;
}

export function registerWorkspaceDocumentTools(mcp: McpServer, deps: WorkspaceDocToolDeps): void {
    const { storage, config, agentGaii, ownerName } = deps;
    const editDeps = { storage, config };

    const fail = (msg: string): TextResult => ({ content: [{ type: 'text', text: msg }], isError: true });
    const caller = (): DocEditCaller => ({ principal: agentGaii, owner: ownerName, roles: ['agent'] });

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
        {
            organism_id: z.string(), ws: z.string(), space: z.string(), id: z.string(),
            markdown: z.string(),
            section: z.string().optional(),
        },
        annotationsFor('aimeat_workspace_doc_append'),
        async ({ organism_id, ws, space, id, markdown, section }): Promise<TextResult> => {
            try {
                return ok(await appendToDocument(editDeps, caller(), {
                    organismId: organism_id, wsId: ws, space, id, markdown,
                    ...(section ? { section } : {}),
                    pipeline: 'mcp.workspace_doc_append',
                }));
            } catch (err) { return editFail(err); }
        });

    mcp.tool('aimeat_workspace_doc_section_replace', descriptionFor('aimeat_workspace_doc_section_replace'),
        {
            organism_id: z.string(), ws: z.string(), space: z.string(), id: z.string(),
            section: z.string(), markdown: z.string(),
        },
        annotationsFor('aimeat_workspace_doc_section_replace'),
        async ({ organism_id, ws, space, id, section, markdown }): Promise<TextResult> => {
            try {
                return ok(await replaceDocumentSection(editDeps, caller(), {
                    organismId: organism_id, wsId: ws, space, id, section, markdown,
                    pipeline: 'mcp.workspace_doc_section',
                }));
            } catch (err) { return editFail(err); }
        });
}
