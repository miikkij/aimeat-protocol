/**
 * @file workspace-create.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_workspace_create, moved out of mcp/workspaces.ts by pure extraction when that
 *   file passed the 800-line limit. What is left here is the door: the tool's parameters, the
 *   JSON-string tolerance MCP clients need, the membership check and the text answer. The
 *   provisioning itself is services/workspace-provision.ts, which is what
 *   POST /v1/organisms/:id/workspaces calls.
 * @structure registerWorkspaceCreateTool(mcp, storage, config, deps)
 * @usage import { registerWorkspaceCreateTool } from './workspace-create.js';
 * @version-history
 *   v1.1.0 — 2026-08-11 — August 2026 audit step 8. The four writes this tool made itself (the
 *     schema locks, the manifest, the readme, the registry entry) were a second copy of
 *     provisionWorkspace(), whose own header had claimed since July that both doors shared it. They
 *     now do, so the next change to provisioning cannot land on the REST road only. `name` is
 *     required non-empty, as the REST route has always required: an empty one produced a workspace
 *     listed as 'Workspace' with a manifest whose name was blank.
 *   v1.0.0 — 2026-08-11 — Extracted from mcp/workspaces.ts (max-file-lines), no behaviour change.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { provisionWorkspace, WorkspaceProvisionError, WorkspaceMetaError } from '../services/workspace-provision.js';
import { updateOrganismStructure } from '../services/structure-snapshot.js';
import { emitChange } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/** The helpers this tool shares with the rest of the workspace surface, passed rather than copied. */
export interface WorkspaceCreateDeps {
    ownerName: string;
    ownerGhii: string;
    writerGaii: string;
    ok: (data: unknown) => TextResult;
    fail: (message: string) => TextResult;
    denyReason: (organismId: string) => Promise<string | null>;
    parseObj: (v: unknown) => unknown;
}

export function registerWorkspaceCreateTool(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    deps: WorkspaceCreateDeps,
): void {
    const { ownerName, ownerGhii, writerGaii, ok, fail, denyReason, parseObj } = deps;

    // ── aimeat_workspace_create ──
    mcp.tool('aimeat_workspace_create', descriptionFor('aimeat_workspace_create'),
        {
            organism_id: z.string(),
            name: z.string().describe('Workspace name'),
            manifest: z.any().describe('The workspace manifest (objectTypes + policy) as a JSON OBJECT, not a string.'),
            schemas: z.any().optional().describe('Map of namespace → JSON Schema for records types, as a JSON OBJECT.'),
            readme: z.string().optional().describe('Optional markdown intro'),
        },
        annotationsFor('aimeat_workspace_create'),
        async ({ organism_id, name, manifest, schemas, readme }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            // A workspace with no name is listed as 'Workspace' and carries a blank manifest name,
            // which is why the REST door refuses it rather than filling it in.
            if (!name || !name.trim()) return fail('name is required');
            const man = parseObj(manifest);
            if (!man || typeof man !== 'object' || Array.isArray(man)) {
                return fail('manifest must be an object with an objectTypes array.');
            }
            try {
                // Everything from here is services/workspace-provision.ts: normalize the objectTypes
                // (rejecting an unsupported backing before anything is written, so a misdeclared
                // space fails the first call instead of becoming invisible data), lock each records
                // schema strict under the owner GHII, write the manifest against its meta-schema with
                // the envelope backfilled, write the readme, and register the workspace.
                const result = await provisionWorkspace(storage, config, {
                    orgId: organism_id, ownerName, ownerGhii, name: name.trim(),
                    manifest: man as Record<string, unknown>,
                    schemas: parseObj(schemas) as Record<string, Record<string, unknown>> | undefined,
                    readme,
                });
                emitChange('organisms');
                void updateOrganismStructure(storage, config, organism_id, { event: 'workspace created', actor: writerGaii }).catch((err: unknown) => { logger.warn('workspaces: timeline best-effort', { error: String(err) }); });
                return ok({ created: true, ...result });
            } catch (e) {
                if (e instanceof WorkspaceProvisionError || e instanceof WorkspaceMetaError) return fail(e.message);
                return fail((e as Error).message || 'Could not create the workspace');
            }
        });
}
