/**
 * @file extensions.ts
 * @description MCP extension tools and resource registrations. Provides 7 tools for extension
 *   lifecycle management (list, invoke, install, activate, deactivate, delete, get) and 1
 *   resource template for reading extension details via the MCP resource protocol.
 * @structure
 *   - registerExtensionsTools() — registers all extension tools and resources on an McpServer instance
 * @usage
 *   import { registerExtensionsTools } from './extensions.js';
 *   registerExtensionsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation: 2 tools + 1 resource for extension management via MCP
 *   v1.1.0 — 2026-05-02 — Add 5 lifecycle tools: install, activate, deactivate, delete, get
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import { executeExtensionAction } from '../services/extension-runtime.js';
import type { ExtensionCtx } from '../services/extension-runtime.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { generateUploadToken } from '../services/upload-token.js';

export function registerExtensionsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // ── Resource: extension details ──
    mcp.registerResource(
        'extension-details',
        new ResourceTemplate('aimeat://extensions/{name}', {
            list: async () => {
                const extensions = await storage.listExtensions();
                const active = extensions.filter(e => e.status === 'active');
                return {
                    resources: active.map(ext => ({
                        uri: `aimeat://extensions/${encodeURIComponent(ext.name)}`,
                        name: ext.name,
                        mimeType: 'application/json',
                        description: `Extension: ${ext.name} v${ext.version} — ${ext.description}`,
                    })),
                };
            },
        }),
        { mimeType: 'application/json', description: 'Extension details and available actions' },
        async (uri, variables) => {
            const name = decodeURIComponent(variables.name as string);
            const ext = await storage.getExtension(name);
            if (!ext) return { contents: [{ uri: uri.toString(), text: 'Extension not found' }] };
            return {
                contents: [{
                    uri: uri.toString(),
                    text: JSON.stringify({
                        name: ext.name,
                        version: ext.version,
                        description: ext.description,
                        author: ext.author,
                        status: ext.status,
                        actions: ext.actions.map(a => ({
                            id: a.id,
                            method: a.method,
                            path: a.path,
                            input_schema: a.inputSchema,
                            output_schema: a.outputSchema,
                        })),
                        required_apis: ext.requiredApis,
                        federation: ext.federation,
                        installed_at: ext.installedAt,
                        activated_at: ext.activatedAt,
                    }, null, 2),
                    mimeType: 'application/json',
                }],
            };
        },
    );

    // ── Tool 1: aimeat_extension_list ──
    mcp.tool(
        'aimeat_extension_list',
        'List active extensions and their available actions',
        {},
        async () => {
            const extensions = await storage.listExtensions();
            const active = extensions.filter(e => e.status === 'active');
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(active.map(ext => ({
                        name: ext.name,
                        version: ext.version,
                        description: ext.description,
                        author: ext.author,
                        actions: ext.actions.map(a => ({
                            id: a.id,
                            method: a.method,
                            path: a.path,
                        })),
                        federation: ext.federation,
                        installed_at: ext.installedAt,
                        activated_at: ext.activatedAt,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_extension_invoke ──
    mcp.tool(
        'aimeat_extension_invoke',
        'Invoke an action on an active extension',
        {
            extension_name: z.string().describe('Name of the extension to invoke'),
            action_id: z.string().describe('ID of the action to execute'),
            input: z.record(z.string(), z.unknown()).optional(),
            instance_id: z.string().optional(),
        },
        async ({ extension_name, action_id, input, instance_id }) => {
            const ext = await storage.getExtension(extension_name);
            if (!ext) {
                return { content: [{ type: 'text' as const, text: `Extension "${extension_name}" not found` }], isError: true };
            }

            if (ext.status !== 'active') {
                return { content: [{ type: 'text' as const, text: `Extension "${extension_name}" is not active` }], isError: true };
            }

            const action = ext.actions.find(a => a.id === action_id);
            if (!action) {
                return { content: [{ type: 'text' as const, text: `Action "${action_id}" not found in extension "${extension_name}"` }], isError: true };
            }

            // If instance_id provided, validate the instance exists and is active
            if (instance_id) {
                const instance = await storage.getExtensionInstance(extension_name, instance_id);
                if (!instance) {
                    return { content: [{ type: 'text' as const, text: `Instance "${instance_id}" not found for extension "${extension_name}"` }], isError: true };
                }
                if (instance.status !== 'active') {
                    return { content: [{ type: 'text' as const, text: `Instance "${instance_id}" of extension "${extension_name}" is not active` }], isError: true };
                }
            }

            // Determine memory namespace (instance-scoped or extension-scoped)
            const effectiveInstanceId = instance_id ?? '_default';
            const extMemoryOwner = instance_id
                ? `ext:${ext.name}.${instance_id}`
                : `ext:${ext.name}`;

            // Build ExtensionCtx for execution
            const ctx: ExtensionCtx = {
                memory: {
                    get: async (key) => {
                        const record = await storage.getMemory(extMemoryOwner, key);
                        return record ? record.value : null;
                    },
                    set: async (key, value) => {
                        const existing = await storage.getMemory(extMemoryOwner, key);
                        const now = new Date().toISOString();
                        await storage.setMemory({
                            key,
                            ownerGaii: extMemoryOwner,
                            value,
                            visibility: 'public',
                            tags: [],
                            ttlHours: null,
                            version: existing ? existing.version + 1 : 1,
                            createdAt: existing ? existing.createdAt : now,
                            updatedAt: now,
                        });
                    },
                    search: async (prefix) => {
                        const records = await storage.listMemory(extMemoryOwner, { prefix });
                        return records.map(r => ({ key: r.key, value: r.value }));
                    },
                    delete: async (key) => storage.deleteMemory(extMemoryOwner, key),
                    getPublic: async (namespace, key) => {
                        let record = await storage.getMemory(namespace, key);
                        if (!record && !namespace.includes('@') && !namespace.includes('#') && !namespace.startsWith('ext:')) {
                            const agents = await storage.getAgentsByOwner(namespace);
                            for (const agent of agents) {
                                record = await storage.getMemory(agent.gaii, key);
                                if (record) break;
                            }
                        }
                        return (record && record.visibility === 'public') ? record.value : null;
                    },
                },
                fetch: async (url, opts) => {
                    const resp = await fetch(url, {
                        method: opts?.method || 'GET',
                        headers: opts?.headers,
                        body: opts?.body,
                        signal: AbortSignal.timeout(30_000),
                    });
                    const buf = await resp.arrayBuffer();
                    const ct = resp.headers.get('content-type') || '';
                    const ctCharsetMatch = /charset=([^\s;]+)/i.exec(ct);
                    const charset = ctCharsetMatch ? ctCharsetMatch[1].toLowerCase() : 'utf-8';
                    const decoder = new TextDecoder(charset === 'utf8' ? 'utf-8' : charset);
                    const text = decoder.decode(buf);
                    const headers: Record<string, string> = {};
                    resp.headers.forEach((v, k) => { headers[k] = v; });
                    return { status: resp.status, ok: resp.ok, text, headers };
                },
                wallet: {
                    consume: async (amount: number, reason: string) => {
                        const debited = await storage.debitBalance(agentGaii, amount);
                        if (!debited) return { success: false, error: 'Insufficient balance' };
                        await storage.addTransaction({
                            id: `ext-tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                            gaii: agentGaii,
                            type: 'extension_consume',
                            amount: -amount,
                            trackingCode: `ext:${ext.name}:${reason}`,
                            timestamp: new Date().toISOString(),
                        });
                        return { success: true };
                    },
                    getBalance: async () => {
                        const parsed = parseGAII(agentGaii);
                        if (!parsed) return 0;
                        const ghii = await storage.getGHIIByOwner(parsed.owner);
                        return ghii?.morselBalance ?? 0;
                    },
                },
                consent: {
                    check: async (gaii, scope) => {
                        const consents = await storage.listConsents(gaii, { status: 'active' });
                        return consents.some(c => c.purpose === scope);
                    },
                    require: async (gaii, scope) => {
                        const consents = await storage.listConsents(gaii, { status: 'active' });
                        if (!consents.some(c => c.purpose === scope)) {
                            throw new Error(`CONSENT_REQUIRED: ${scope}`);
                        }
                    },
                },
                trust: {
                    getScore: async (gaii: string) => {
                        const agent = await storage.getAgent(gaii);
                        return agent?.trustScore ?? 0;
                    },
                },
                caller: {
                    gaii: agentGaii,
                    owner: parseGAII(agentGaii)?.owner ?? agentGaii,
                    roles: ['agent'],
                },
                config: ext.config,
                ...(instance_id ? {
                    instance: {
                        id: instance_id,
                        config: (await storage.getExtensionInstance(extension_name, instance_id))?.config ?? {},
                    },
                } : {}),
                log: {
                    info: (msg, data) => logger.info(`[ext:${ext.name}${instance_id ? ':' + instance_id : ''}] ${msg}`, data),
                    warn: (msg, data) => logger.warn(`[ext:${ext.name}${instance_id ? ':' + instance_id : ''}] ${msg}`, data),
                    error: (msg, data) => logger.error(`[ext:${ext.name}${instance_id ? ':' + instance_id : ''}] ${msg}`, data),
                },
                notify: async (message: string, opts?: { title?: string; priority?: string; channel?: string }) => {
                    const parsed = parseGAII(agentGaii);
                    if (!parsed) return false;
                    const key = `notifications.${parsed.owner}`;
                    const existing = await storage.getMemory(agentGaii, key);
                    const list = Array.isArray(existing?.value) ? (existing.value as unknown[]) : [];
                    list.push({
                        id: randomUUID(),
                        message,
                        title: opts?.title || ext.name,
                        priority: opts?.priority || 'normal',
                        channel: opts?.channel || 'extension',
                        source: ext.name,
                        read: false,
                        createdAt: new Date().toISOString(),
                    });
                    const trimmed = list.slice(-100);
                    await storage.setMemory({
                        key,
                        ownerGaii: agentGaii,
                        value: trimmed,
                        visibility: 'private',
                        tags: ['notifications'],
                        ttlHours: null,
                        version: (existing?.version || 0) + 1,
                        createdAt: existing?.createdAt || new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    });
                    return true;
                },
                email: async (_to: string, _subject: string, _body: string) => {
                    logger.warn(`[ext:${ext.name}] Email not available via MCP`);
                    return false;
                },
            };

            try {
                const limits = {
                    memoryMb: Math.max(ext.limits.memoryMb, config.extensionMaxMemoryMb),
                    timeoutMs: Math.max(ext.limits.timeoutMs, config.extensionTimeoutMs),
                    maxApiCalls: Math.max(ext.limits.maxApiCalls, config.extensionMaxApiCalls),
                };
                const result = await executeExtensionAction(action.scriptContent, ctx, input ?? {}, limits);

                emitResourceUpdated(agentGaii, `aimeat://extensions/${encodeURIComponent(extension_name)}`);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify(result, null, 2),
                    }],
                };
            } catch (err) {
                const message = (err as Error).message;
                logger.error(`MCP extension action failed: ${extension_name}/${action_id}`, { error: message, caller: agentGaii });
                return {
                    content: [{ type: 'text' as const, text: `Action "${action_id}" failed: ${message}` }],
                    isError: true,
                };
            }
        },
    );

    // ── Tool 3: aimeat_extension_install ──
    mcp.tool(
        'aimeat_extension_install',
        `Install a new extension. Two modes:
UPLOAD MODE (recommended): Call with no arguments to get an upload URL. Create a ZIP containing manifest.yaml at root and scripts in scripts/ directory, then PUT it to the URL.
INLINE MODE: Provide manifest (YAML string) and scripts (filename-to-code map) directly.`,
        {
            manifest: z.string().optional().describe('Extension manifest in YAML format. Omit to get an upload URL for a ZIP bundle.'),
            scripts: z.record(z.string(), z.string()).optional().describe('Map of script filename to JavaScript source code. Omit for upload mode.'),
        },
        async ({ manifest: manifestYaml, scripts }) => {
            // --- UPLOAD MODE: no manifest provided, return presigned upload URL ---
            if (!manifestYaml) {
                const maxBytes = config.extensionMaxCodeSizeKb * 1024 * 50;
                const token = await generateUploadToken({
                    sub: getAgentGaii(),
                    utype: 'extension',
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
                            zip_structure: 'manifest.yaml at root, scripts in scripts/ directory',
                            note: 'Create a ZIP with manifest.yaml and scripts/*.js, then PUT it to upload_url.',
                        }, null, 2),
                    }],
                };
            }

            // --- INLINE MODE: manifest provided, process immediately ---
            if (!scripts) {
                return { content: [{ type: 'text' as const, text: 'scripts is required when using inline mode (manifest provided)' }], isError: true };
            }

            // Parse manifest YAML
            let manifest: Record<string, unknown>;
            try {
                manifest = parseYaml(manifestYaml) as Record<string, unknown>;
            } catch {
                return { content: [{ type: 'text' as const, text: 'Failed to parse manifest YAML' }], isError: true };
            }

            // Validate required metadata fields
            const metadata = manifest.metadata as Record<string, unknown> | undefined;
            if (!metadata?.name || !metadata?.version || !metadata?.description || !metadata?.author) {
                return {
                    content: [{ type: 'text' as const, text: 'metadata.name, metadata.version, metadata.description, and metadata.author are required' }],
                    isError: true,
                };
            }

            // Validate actions array
            const actions = manifest.actions as Array<Record<string, unknown>> | undefined;
            if (!Array.isArray(actions) || actions.length === 0) {
                return { content: [{ type: 'text' as const, text: 'actions array is required and must not be empty' }], isError: true };
            }

            for (const action of actions) {
                if (!action.id || !action.method || !action.path || !action.script) {
                    return {
                        content: [{ type: 'text' as const, text: 'Each action must have id, method, path, and script fields' }],
                        isError: true,
                    };
                }
                if (!scripts[action.script as string]) {
                    return {
                        content: [{ type: 'text' as const, text: `Script "${action.script as string}" referenced in action "${action.id as string}" not found in scripts object` }],
                        isError: true,
                    };
                }
            }

            // Check if extension already exists
            const name = metadata.name as string;
            const existingExt = await storage.getExtension(name);
            if (existingExt) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" is already installed` }], isError: true };
            }

            // Build ExtensionRecord
            const manifestConfig = manifest.config as Record<string, unknown> | undefined;
            const manifestLimits = manifest.limits as Record<string, unknown> | undefined;
            const manifestFederation = manifest.federation as Record<string, unknown> | undefined;
            const manifestSchedules = manifest.schedules as Array<Record<string, unknown>> | undefined;
            const manifestInstances = manifest.instances as Record<string, unknown> | undefined;

            const record: ExtensionRecord = {
                name,
                version: metadata.version as string,
                description: metadata.description as string,
                author: metadata.author as string,
                status: 'inactive',
                requiredApis: (manifest.required_apis as string[]) ?? [],
                actions: actions.map(a => ({
                    id: a.id as string,
                    method: (a.method as string).toUpperCase(),
                    path: a.path as string,
                    inputSchema: (a.input as Record<string, unknown>) ?? {},
                    outputSchema: (a.output as Record<string, unknown>) ?? {},
                    scriptContent: scripts[a.script as string],
                })),
                config: {
                    ...(manifestConfig
                        ? Object.fromEntries(
                            Object.entries(manifestConfig).map(([k, v]) => {
                                if (v && typeof v === 'object' && 'default' in (v as Record<string, unknown>)) {
                                    return [k, (v as Record<string, unknown>).default];
                                }
                                return [k, v];
                            }),
                        )
                        : {}),
                    ...(manifestSchedules ? { __schedules: manifestSchedules } : {}),
                },
                limits: {
                    memoryMb: Math.min(
                        (manifestLimits?.memory_mb as number) ?? config.extensionMaxMemoryMb,
                        config.extensionMaxMemoryMb,
                    ),
                    timeoutMs: Math.min(
                        (manifestLimits?.timeout_ms as number) ?? config.extensionTimeoutMs,
                        config.extensionTimeoutMs,
                    ),
                    maxApiCalls: Math.min(
                        (manifestLimits?.max_api_calls as number) ?? config.extensionMaxApiCalls,
                        config.extensionMaxApiCalls,
                    ),
                },
                federation: {
                    advertise: (manifestFederation?.advertise as boolean) ?? false,
                    capabilities: (manifestFederation?.capabilities as string[]) ?? [],
                },
                ...(manifestInstances?.supported ? {
                    instances: {
                        supported: true,
                        configSchema: (manifestInstances.config_per_instance as Record<string, unknown>) ?? undefined,
                    },
                } : {}),
                installedBy: parseGAII(getAgentGaii())?.owner ?? 'mcp-agent',
                installedAt: new Date().toISOString(),
            };

            try {
                const created = await storage.createExtension(record);
                logger.info(`Extension installed via MCP: ${created.name}`, { version: created.version, by: record.installedBy });

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            name: created.name,
                            version: created.version,
                            status: created.status,
                            actions: created.actions.map(a => ({ id: a.id, method: a.method, path: a.path })),
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Failed to install extension: ${(err as Error).message}` }], isError: true };
            }
        },
    );

    // ── Tool 4: aimeat_extension_activate ──
    mcp.tool(
        'aimeat_extension_activate',
        'Activate an installed extension',
        {
            name: z.string().describe('Name of the extension to activate'),
        },
        async ({ name }) => {
            const ext = await storage.getExtension(name);
            if (!ext) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" not found` }], isError: true };
            }

            try {
                await storage.updateExtension(name, {
                    status: 'active',
                    activatedAt: new Date().toISOString(),
                });

                // Trigger capability aggregation so the extension appears immediately
                import('../services/capability-aggregator.js')
                    .then(m => m.runCapabilityAggregation(config, storage))
                    .catch(() => {});

                logger.info(`Extension activated via MCP: ${name}`, { by: getAgentGaii() });

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ name, status: 'active', activated_at: new Date().toISOString() }, null, 2),
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Failed to activate extension: ${(err as Error).message}` }], isError: true };
            }
        },
    );

    // ── Tool 5: aimeat_extension_deactivate ──
    mcp.tool(
        'aimeat_extension_deactivate',
        'Deactivate an active extension',
        {
            name: z.string().describe('Name of the extension to deactivate'),
        },
        async ({ name }) => {
            const ext = await storage.getExtension(name);
            if (!ext) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" not found` }], isError: true };
            }

            try {
                await storage.updateExtension(name, { status: 'inactive' });

                logger.info(`Extension deactivated via MCP: ${name}`, { by: getAgentGaii() });

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ name, status: 'inactive' }, null, 2),
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Failed to deactivate extension: ${(err as Error).message}` }], isError: true };
            }
        },
    );

    // ── Tool 6: aimeat_extension_delete ──
    mcp.tool(
        'aimeat_extension_delete',
        'Delete/uninstall an extension',
        {
            name: z.string().describe('Name of the extension to delete'),
        },
        async ({ name }) => {
            const ext = await storage.getExtension(name);
            if (!ext) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" not found` }], isError: true };
            }

            try {
                // Deactivate first if active
                if (ext.status === 'active') {
                    await storage.updateExtension(name, { status: 'inactive' });
                }

                await storage.deleteExtension(name);

                logger.info(`Extension deleted via MCP: ${name}`, { by: getAgentGaii() });

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ name, deleted: true }, null, 2),
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Failed to delete extension: ${(err as Error).message}` }], isError: true };
            }
        },
    );

    // ── Tool 7: aimeat_extension_get ──
    mcp.tool(
        'aimeat_extension_get',
        'Get full extension details including action schemas',
        {
            name: z.string().describe('Name of the extension to retrieve'),
        },
        async ({ name }) => {
            const ext = await storage.getExtension(name);
            if (!ext) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" not found` }], isError: true };
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        name: ext.name,
                        version: ext.version,
                        description: ext.description,
                        author: ext.author,
                        status: ext.status,
                        required_apis: ext.requiredApis,
                        actions: ext.actions.map(a => ({
                            id: a.id,
                            method: a.method,
                            path: a.path,
                            input_schema: a.inputSchema,
                            output_schema: a.outputSchema,
                        })),
                        config: ext.config,
                        limits: ext.limits,
                        federation: ext.federation,
                        instances: ext.instances,
                        installed_by: ext.installedBy,
                        installed_at: ext.installedAt,
                        activated_at: ext.activatedAt,
                    }, null, 2),
                }],
            };
        },
    );
}
