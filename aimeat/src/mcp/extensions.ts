/**
 * @file extensions.ts
 * @description MCP extension tools and resource registrations. Provides 2 tools for extension
 *   management (list active extensions, invoke an extension action) and 1 resource template
 *   for reading extension details via the MCP resource protocol.
 * @structure
 *   - registerExtensionsTools() — registers all extension tools and resources on an McpServer instance
 * @usage
 *   import { registerExtensionsTools } from './extensions.js';
 *   registerExtensionsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation: 2 tools + 1 resource for extension management via MCP
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { executeExtensionAction } from '../services/extension-runtime.js';
import type { ExtensionCtx } from '../services/extension-runtime.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

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
}
