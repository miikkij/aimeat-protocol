/**
 * @file cortex.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP cortex lifecycle tools. Provides 5 tools for cortex extension management:
 *   list, install, activate, deactivate, and delete cortex extensions via the MCP protocol.
 * @structure
 *   - registerCortexTools() - registers all cortex tools on an McpServer instance
 * @usage
 *   import { registerCortexTools } from './cortex.js';
 *   registerCortexTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 - 2026-05-02 - Initial creation: 5 tools for cortex lifecycle management via MCP
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 -- 2026-08-11 -- The inline install branch checks namespace ownership, which the HTTP door
 *     and the presigned road both do. Cortex lib files are served as JavaScript from the apex origin,
 *     so a fresh name inside another owner's namespace was a squat on their front door.
 *   v1.4.0 -- 2026-08-11 -- Install, activate, deactivate and delete call
 *     services/cortex-lifecycle.ts, the same functions POST/DELETE /v1/cortex and the
 *     activate/deactivate routes call. Three of the four were doing less than their HTTP twin:
 *     activate flipped the status without materialising the cortex's components, deactivate
 *     without tearing them down, delete without removing the seed-data memory. What stays here is
 *     the upload-mode branch, the text rendering and the resource notification.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { generateUploadToken } from '../services/upload-token.js';
import {
    installCortex, activateCortex, deactivateCortex, deleteCortex,
    type CortexCaller, type CortexRefusal,
} from '../services/cortex-lifecycle.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

export function registerCortexTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {

    /**
     * The owner behind this session. Every ownership check here compares against it, and it is what
     * an installed cortex records as `installedBy`.
     *
     * An agent session's sub is a GAII, so the owner is its middle part. An owner session's sub is
     * the bare owner name already, which is why the fallback is the sub and not the empty string:
     * with '' the four tools disagreed, install writing `installedBy: 'alice'` while activate
     * compared 'alice' against '' and refused the owner their own cortex.
     */
    const callerOwner = parseGAII(getAgentGaii())?.owner ?? getAgentGaii();

    /**
     * The caller as services/cortex-lifecycle.ts sees it.
     *
     * `isOperator` is false on the lifecycle three on purpose: an MCP session is an agent, and an
     * operator managing somebody else's cortex does it through the HTTP door. Install passes the
     * owner's real role instead, because the namespace claim is the one place this surface has
     * always honoured it. The two doors therefore disagree about operators, which is a live
     * question for the developer rather than something to settle by extraction.
     */
    const agentCaller = (isOperator = false): CortexCaller => ({
        ownerName: callerOwner,
        gaii: getAgentGaii(),
        isOperator,
    });

    /**
     * A refusal, as text. On a named cortex both "no such name" and "not yours" answer the same
     * sentence: this surface has always refused that way, so that probing names cannot confirm what
     * another owner has installed. The HTTP door separates the two, because it answers a caller who
     * is already inside a session it can hold responsible.
     */
    const refusalText = (refusal: CortexRefusal, name?: string): string =>
        (name && (refusal.code === 'NOT_FOUND' || refusal.code === 'FORBIDDEN'))
            ? `Cortex extension not found: ${name}`
            : `${refusal.code}: ${refusal.message}`;

    // ── Tool 1: aimeat_cortex_list ──
    mcp.tool(
        'aimeat_cortex_list',
        descriptionFor('aimeat_cortex_list'),
        {},
        annotationsFor('aimeat_cortex_list'),
        async () => {
            const extensions = await storage.listCortexExtensions({});
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(extensions.map(ext => ({
                        name: ext.name,
                        version: ext.version,
                        description: ext.description,
                        status: ext.status,
                        visibility: ext.visibility,
                        tags: ext.tags,
                        namespace: ext.namespace,
                        author: ext.author,
                        installed_at: ext.installedAt,
                        activated_at: ext.activatedAt,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_cortex_install ──
    mcp.tool(
        'aimeat_cortex_install',
        descriptionFor('aimeat_cortex_install'),
        {
            manifest: z.string().optional().describe('YAML manifest string. Omit to get an upload URL for a ZIP bundle.'),
            libs: z.record(z.string(), z.string()).optional().describe('Map of filename to JavaScript source code for lib files.'),
        },
        annotationsFor('aimeat_cortex_install'),
        async ({ manifest, libs }) => {
            const agentGaii = getAgentGaii();

            // --- UPLOAD MODE: no manifest provided, return presigned upload URL ---
            if (!manifest) {
                const maxBytes = config.cortexMaxLibSizeKb * 1024 * 50;
                const token = await generateUploadToken({
                    sub: agentGaii,
                    utype: 'cortex',
                    meta: {},
                    maxBytes,
                    contentType: 'application/zip',
                });

                const uploadUrl = `${config.baseUrl}/v1/upload/${token}`;

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            mode: 'upload',
                            upload_url: uploadUrl,
                            upload_method: 'PUT',
                            content_type: 'application/zip',
                            max_size_bytes: maxBytes,
                            expires_in_seconds: 3600,
                            zip_structure: 'manifest.yaml at root, lib files in libs/ directory',
                            note: 'Create a ZIP with manifest.yaml and libs/*.js, then PUT it to upload_url.',
                        }, null, 2),
                    }],
                };
            }

            // --- INLINE MODE: manifest provided, process immediately ---

            // An agent token carries the operator role when its owner holds it
            // (routes/auth.ts:265-267), so the role is read off the owner record. It buys one thing
            // here: a namespace this owner does not own.
            const ownerRec = await storage.getOwner(callerOwner);
            const out = await installCortex(
                { storage, config },
                agentCaller(ownerRec?.roles.includes('operator') ?? false),
                { manifest, libs },
            );
            if (!out.ok) {
                return { content: [{ type: 'text' as const, text: refusalText(out.refusal) }], isError: true };
            }

            const { record, warnings } = out.value;
            emitResourceListChanged(agentGaii);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        name: record.name,
                        namespace: record.namespace,
                        version: record.version,
                        status: record.status,
                        installed_at: record.installedAt,
                        installed_by: record.installedBy,
                        component_count: record.components.length,
                        warnings,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_cortex_activate ──
    mcp.tool(
        'aimeat_cortex_activate',
        descriptionFor('aimeat_cortex_activate'),
        {
            name: z.string().describe('Name of the cortex extension to activate'),
        },
        annotationsFor('aimeat_cortex_activate'),
        async ({ name }) => {
            const agentGaii = getAgentGaii();
            const out = await activateCortex({ storage, config }, agentCaller(), name);
            if (!out.ok) {
                return { content: [{ type: 'text' as const, text: refusalText(out.refusal, name) }], isError: true };
            }

            const { extension, activatedAt, alreadyActive } = out.value;
            if (alreadyActive) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            name: extension.name,
                            status: 'active',
                            activated_at: activatedAt,
                            message: 'Extension is already active',
                        }, null, 2),
                    }],
                };
            }

            emitResourceListChanged(agentGaii);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        name: extension.name,
                        status: 'active',
                        activated_at: activatedAt,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 4: aimeat_cortex_deactivate ──
    mcp.tool(
        'aimeat_cortex_deactivate',
        descriptionFor('aimeat_cortex_deactivate'),
        {
            name: z.string().describe('Name of the cortex extension to deactivate'),
        },
        annotationsFor('aimeat_cortex_deactivate'),
        async ({ name }) => {
            const agentGaii = getAgentGaii();
            const out = await deactivateCortex({ storage, config }, agentCaller(), name);
            if (!out.ok) {
                return { content: [{ type: 'text' as const, text: refusalText(out.refusal, name) }], isError: true };
            }

            const { extension, alreadyInactive } = out.value;
            if (alreadyInactive) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            name: extension.name,
                            status: 'inactive',
                            message: 'Extension is already inactive',
                        }, null, 2),
                    }],
                };
            }

            emitResourceListChanged(agentGaii);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        name: extension.name,
                        status: 'inactive',
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 5: aimeat_cortex_delete ──
    mcp.tool(
        'aimeat_cortex_delete',
        descriptionFor('aimeat_cortex_delete'),
        {
            name: z.string().describe('Name of the cortex extension to delete'),
        },
        annotationsFor('aimeat_cortex_delete'),
        async ({ name }) => {
            const agentGaii = getAgentGaii();
            const out = await deleteCortex({ storage, config }, agentCaller(), name);
            if (!out.ok) {
                return { content: [{ type: 'text' as const, text: refusalText(out.refusal, name) }], isError: true };
            }

            emitResourceListChanged(agentGaii);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        deleted: true,
                        name,
                    }, null, 2),
                }],
            };
        },
    );
}
