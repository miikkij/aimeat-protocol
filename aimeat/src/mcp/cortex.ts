/**
 * @file cortex.ts
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
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseCortexManifest } from '../services/cortex-manifest.js';
import { runCapabilityAggregation } from '../services/capability-aggregator.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { generateUploadToken } from '../services/upload-token.js';
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
            const parsed = parseGAII(agentGaii);
            const ownerName = parsed?.owner ?? agentGaii;

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

            // Validate manifest is a string
            if (typeof manifest !== 'string') {
                return { content: [{ type: 'text' as const, text: 'manifest must be a YAML string' }], isError: true };
            }

            // Manifest size limit
            const manifestSizeKb = Buffer.byteLength(manifest, 'utf-8') / 1024;
            if (manifestSizeKb > config.cortexMaxLibSizeKb) {
                return { content: [{ type: 'text' as const, text: `Manifest size ${Math.round(manifestSizeKb)}KB exceeds limit of ${config.cortexMaxLibSizeKb}KB` }], isError: true };
            }

            // Check install limit
            const existing = await storage.listCortexExtensions();
            if (existing.length >= config.cortexMaxInstalled) {
                return { content: [{ type: 'text' as const, text: `Maximum ${config.cortexMaxInstalled} cortex extensions allowed. Uninstall unused extensions first.` }], isError: true };
            }

            // Validate lib sizes
            if (libs) {
                for (const [filename, content] of Object.entries(libs)) {
                    if (typeof content !== 'string') {
                        return { content: [{ type: 'text' as const, text: `libs["${filename}"] must be a string` }], isError: true };
                    }
                    const sizeKb = Buffer.byteLength(content, 'utf8') / 1024;
                    if (sizeKb > config.cortexMaxLibSizeKb) {
                        return { content: [{ type: 'text' as const, text: `Lib "${filename}" is ${sizeKb.toFixed(1)}KB, max is ${config.cortexMaxLibSizeKb}KB` }], isError: true };
                    }
                }
            }

            // Parse and validate manifest
            const result = parseCortexManifest(manifest, ownerName, libs);

            if (!result.ok || !result.extension) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            error: 'Manifest validation failed',
                            errors: result.errors,
                            warnings: result.warnings,
                        }, null, 2),
                    }],
                    isError: true,
                };
            }

            const ext = result.extension;

            // Store lib files
            if (libs) {
                for (const [filename, content] of Object.entries(libs)) {
                    await storage.setCortexLibFile(ext.name, filename, content);
                }
            }

            try {
                const record = await storage.createCortexExtension(ext);

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
                            warnings: result.warnings,
                        }, null, 2),
                    }],
                };
            } catch (e: unknown) {
                const msg = (e as Error).message;
                if (msg.includes('already exists')) {
                    return { content: [{ type: 'text' as const, text: `Extension "${ext.name}" is already installed` }], isError: true };
                }
                throw e;
            }
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
            const ext = await storage.getCortexExtension(name);

            if (!ext) {
                return { content: [{ type: 'text' as const, text: `Cortex extension not found: ${name}` }], isError: true };
            }

            // Idempotent - already active
            if (ext.status === 'active') {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            name: ext.name,
                            status: 'active',
                            activated_at: ext.activatedAt,
                            message: 'Extension is already active',
                        }, null, 2),
                    }],
                };
            }

            const now = new Date().toISOString();
            await storage.updateCortexExtension(name, {
                status: 'active',
                activatedAt: now,
            });

            // Trigger capability aggregation
            runCapabilityAggregation(config, storage).catch(err =>
                logger.error('Capability aggregation failed after cortex activation', { error: String(err) }),
            );

            emitResourceListChanged(agentGaii);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        name: ext.name,
                        status: 'active',
                        activated_at: now,
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
            const ext = await storage.getCortexExtension(name);

            if (!ext) {
                return { content: [{ type: 'text' as const, text: `Cortex extension not found: ${name}` }], isError: true };
            }

            // Idempotent - already inactive
            if (ext.status === 'inactive') {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            name: ext.name,
                            status: 'inactive',
                            message: 'Extension is already inactive',
                        }, null, 2),
                    }],
                };
            }

            await storage.updateCortexExtension(name, {
                status: 'inactive',
                activatedAt: undefined,
            });

            emitResourceListChanged(agentGaii);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        name: ext.name,
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
            const ext = await storage.getCortexExtension(name);

            if (!ext) {
                return { content: [{ type: 'text' as const, text: `Cortex extension not found: ${name}` }], isError: true };
            }

            // Deactivate first if active
            if (ext.status === 'active') {
                await storage.updateCortexExtension(name, {
                    status: 'inactive',
                    activatedAt: undefined,
                });
            }

            // Remove lib files
            for (const comp of ext.components) {
                if (comp.type === 'lib') {
                    await storage.deleteCortexLibFile(name, comp.filename);
                }
            }

            await storage.deleteCortexExtension(name);

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
