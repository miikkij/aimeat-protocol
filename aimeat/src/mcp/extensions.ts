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
 *   v1.2.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.3.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.1 -- 2026-06-19 -- Security (CR-1): ctx.wallet.consume rejects non-positive/non-finite amounts before debiting.
 *   v1.4.0 — 2026-07-16 — ctx.memory.getPublic owner-agent fallback batches into one listMemoryForOwners
 *   v1.5.0 — 2026-07-19 — aimeat_extension_install gains update:true (in-place upsert preserving
 *     lifecycle + ext: memory, owner-gated) and activate:true (skip separate activate call);
 *     closes pitfall ext/extension-install-no-upsert
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { validateActionPricing } from '../routes/extensions/manifest.js';
import { SECRET_KEYS_FIELD, computeManifestSecretKeys, getExtSecretKeys, getInstanceSecretKeys, decryptSecretFields, maskSecretFields, prepareSecretConfigForWrite } from '../services/extension-secrets.js';
import { getEncryptionKey } from '../services/encryption.js';
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import { executeExtensionAction } from '../services/extension-runtime.js';
import type { ExtensionCtx } from '../services/extension-runtime.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { notify } from '../services/notify.js';
import { generateUploadToken, buildUploadMeta } from '../services/upload-token.js';
import { enforceExtensionMemoryLimits } from '../services/quota.js';
import { safeFetch } from '../utils/url-validator.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { defineAppIam } from '../services/iam/define-app-iam.js';

export function registerExtensionsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
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
        descriptionFor('aimeat_extension_list'),
        {},
        annotationsFor('aimeat_extension_list'),
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

    // ── Tool: aimeat_iam_define (P5 — validate + design an app's IAM level schema + command manifest) ──
    mcp.tool(
        'aimeat_iam_define',
        descriptionFor('aimeat_iam_define'),
        {
            app_id: z.string().optional().describe('App id / name for the schema label'),
            levels: z.array(z.object({
                level: z.number(), key: z.string(), label: z.string(), capabilities: z.array(z.string()),
            })).describe('Level schema: BBS ordinal levels (lower = more power; level 0 must hold "*") → app capabilities'),
            commands: z.array(z.object({
                id: z.string(), description: z.string(), capability: z.string(),
                tier: z.enum(['read', 'write', 'irreversible']),
            })).describe('Command manifest: commands → required capability + mutation tier'),
        },
        annotationsFor('aimeat_iam_define'),
        async ({ app_id, levels, commands }) => {
            const result = defineAppIam({ appId: app_id, levels, commands });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    // ── Tool 2: aimeat_extension_invoke ──
    mcp.tool(
        'aimeat_extension_invoke',
        descriptionFor('aimeat_extension_invoke'),
        {
            extension_name: z.string().describe('Name of the extension to invoke'),
            action_id: z.string().describe('ID of the action to execute'),
            input: z.record(z.string(), z.unknown()).optional(),
            instance_id: z.string().optional(),
        },
        annotationsFor('aimeat_extension_invoke'),
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
                        await enforceExtensionMemoryLimits(config, storage, extMemoryOwner, key, value);
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
                            // One IN query for `key` across the owner's agents (was getMemory per
                            // agent). First agent (original order) with the key; visibility checked after.
                            const rows = await storage.listMemoryForOwners(agents.map(a => a.gaii), { prefix: key });
                            const byGaii = new Map(rows.filter(r => r.key === key).map(r => [r.ownerGaii, r]));
                            for (const agent of agents) {
                                const r = byGaii.get(agent.gaii);
                                if (r) { record = r; break; }
                            }
                        }
                        return (record && record.visibility === 'public') ? record.value : null;
                    },
                },
                fetch: async (url, opts) => {
                    // safeFetch validates the URL and re-validates every redirect hop (SSRF guard).
                    const resp = await safeFetch(url, {
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
                        // SECURITY: reject non-positive/non-finite amounts — a negative amount would mint morsels (CR-1).
                        if (!Number.isFinite(amount) || amount <= 0) {
                            return { success: false, error: 'INVALID_AMOUNT: consume amount must be a positive number' };
                        }
                        const debited = await storage.debitBalance(agentGaii, amount);
                        if (!debited) return { success: false, error: 'Insufficient balance' };
                        await storage.addTransaction({
                            id: `ext-tx-${randomUUID()}`,
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
                // Decrypted for the VM as routes/extensions/actions.ts does; the { encrypted } wrapper would silently break the script.
                config: decryptSecretFields(ext.config, getExtSecretKeys(ext), getEncryptionKey(config)),
                ...(instance_id ? {
                    instance: {
                        id: instance_id,
                        config: decryptSecretFields((await storage.getExtensionInstance(extension_name, instance_id))?.config ?? {}, getInstanceSecretKeys(ext), getEncryptionKey(config)),
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
                    // Also surface it where the owner actually looks: the header bell + web push,
                    // deep-linked to the Extensions tab.
                    void notify(storage, `${parsed.owner}@${config.nodeId}`, {
                        type: 'extension', title: opts?.title || ext.name, body: message, link: '/v1/profile?tab=extensions',
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
        descriptionFor('aimeat_extension_install'),
        {
            manifest: z.string().optional().describe('Extension manifest in YAML format. Omit to get an upload URL for a ZIP bundle.'),
            scripts: z.record(z.string(), z.string()).optional().describe('Map of script filename to JavaScript source code. Omit for upload mode.'),
            update: z.boolean().optional().describe('Upsert an already-installed extension in place (same validation; activation status, lifecycle fields and its ext: memory are preserved). Without this flag an existing name is an error.'),
            activate: z.boolean().optional().describe('Activate immediately after install/update — skips the separate aimeat_extension_activate call.'),
        },
        annotationsFor('aimeat_extension_install'),
        async ({ manifest: manifestYaml, scripts, update, activate }) => {
            // --- UPLOAD MODE: no manifest provided, return presigned upload URL ---
            if (!manifestYaml) {
                const maxBytes = config.extensionMaxCodeSizeKb * 1024 * 50;
                // The caller's update/activate intent must survive into the token, or the upload
                // silently ignores it: this meta used to be `{}`, so `update: true` was accepted
                // here and the PUT still failed ALREADY_EXISTS. buildUploadMeta picks exactly the
                // keys PRESIGNED_META_KEYS declares for this utype.
                const token = await generateUploadToken({
                    sub: getAgentGaii(),
                    utype: 'extension',
                    meta: buildUploadMeta('extension', { update, activate }),
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
                // Per-action pricing (tollMorsels / commercial) — validate here so the MCP install path
                // matches REST (C1/M1); without this the fields were silently dropped and calls ran free.
                const pricingErr = validateActionPricing(action, action.id as string);
                if (pricingErr && !pricingErr.ok) {
                    return { content: [{ type: 'text' as const, text: pricingErr.message }], isError: true };
                }
            }

            // Check if extension already exists
            const name = metadata.name as string;
            const existingExt = await storage.getExtension(name);
            if (existingExt && !update) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" is already installed — pass update: true to upsert it in place (activation status and its ext: memory are preserved), or delete + reinstall.` }], isError: true };
            }
            if (existingExt && update) {
                // Only the installing owner may update their extension in place.
                const callerOwner = parseGAII(getAgentGaii())?.owner ?? '';
                if (existingExt.installedBy && existingExt.installedBy !== callerOwner) {
                    return { content: [{ type: 'text' as const, text: `Extension "${name}" was installed by "${existingExt.installedBy}" — only the installing owner may update it` }], isError: true };
                }
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
                    // Carry per-action pricing through (validated above) — priced EXCHANGE providers must
                    // survive an MCP/Claude-chat install, not just the REST path.
                    ...(a.tollMorsels !== undefined ? { tollMorsels: a.tollMorsels as number } : {}),
                    ...(a.commercial !== undefined ? { commercial: a.commercial as ExtensionRecord['actions'][number]['commercial'] } : {}),
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
                    // Mark `type: 'secret'` fields as the REST builder does; without it they are stored as the plaintext the flatten pulled from `default`.
                    ...((): Record<string, unknown> => {
                        const secretKeys = computeManifestSecretKeys(manifestConfig);
                        return secretKeys.length ? { [SECRET_KEYS_FIELD]: secretKeys } : {};
                    })(),
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

            // Encrypt secrets before any write, as POST/PUT /v1/extensions do. This path wrote config straight to storage, so a `type: secret` value was persisted in the clear and served unauthenticated.
            const preparedConfig = prepareSecretConfigForWrite(record.config, existingExt?.config, getEncryptionKey(config));
            if (preparedConfig === null) {
                return {
                    content: [{ type: 'text' as const, text: 'ENCRYPTION_NOT_CONFIGURED: this manifest declares a secret config field but the node has no encryption key. Set AIMEAT_ENCRYPTION_KEY or drop the secret field; a secret is never stored in plaintext.' }],
                    isError: true,
                };
            }
            record.config = preparedConfig;

            try {
                let result: ExtensionRecord;
                let action: 'installed' | 'updated';
                if (existingExt) {
                    // In-place upsert (mirrors PUT /v1/extensions/:name): swap code + metadata,
                    // preserve lifecycle fields (status, installedBy/At, activatedAt) and ext: memory.
                    const updated = await storage.updateExtension(name, {
                        version: record.version,
                        description: record.description,
                        author: record.author,
                        requiredApis: record.requiredApis,
                        actions: record.actions,
                        config: record.config,
                        limits: record.limits,
                        federation: record.federation,
                        instances: record.instances,
                    });
                    result = updated ?? { ...record, status: existingExt.status };
                    action = 'updated';
                    logger.info(`Extension updated via MCP: ${name}`, { version: record.version, by: record.installedBy });
                } else {
                    result = await storage.createExtension(record);
                    action = 'installed';
                    logger.info(`Extension installed via MCP: ${result.name}`, { version: result.version, by: record.installedBy });
                }

                // Optional immediate activation (skips the separate activate call).
                let status = result.status;
                if (activate && status !== 'active') {
                    await storage.updateExtension(name, { status: 'active', activatedAt: new Date().toISOString() });
                    status = 'active';
                }
                // Actions may have changed (or just went live) — refresh aggregated capabilities.
                if (status === 'active') {
                    import('../services/capability-aggregator.js')
                        .then(m => m.runCapabilityAggregation(config, storage))
                        .catch(() => {});
                }

                // An ACTIVE extension whose manifest declares schedules needs a schedule
                // re-registration this tool cannot perform — point at the REST upsert.
                const manifestSchedules = manifest.schedules as unknown[] | undefined;
                const scheduleNote = (action === 'updated' && status === 'active' && Array.isArray(manifestSchedules) && manifestSchedules.length > 0)
                    ? 'schedules in the manifest are NOT re-registered by this tool — use PUT /v1/extensions/{name} (REST upsert) or deactivate + activate to refresh them'
                    : undefined;

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            name: result.name,
                            version: result.version,
                            status,
                            action,
                            ...(scheduleNote ? { note: scheduleNote } : {}),
                            actions: result.actions.map(a => ({ id: a.id, method: a.method, path: a.path })),
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Failed to ${update ? 'update' : 'install'} extension: ${(err as Error).message}` }], isError: true };
            }
        },
    );

    // ── Tool 4: aimeat_extension_activate ──
    mcp.tool(
        'aimeat_extension_activate',
        descriptionFor('aimeat_extension_activate'),
        {
            name: z.string().describe('Name of the extension to activate'),
        },
        annotationsFor('aimeat_extension_activate'),
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
        descriptionFor('aimeat_extension_deactivate'),
        {
            name: z.string().describe('Name of the extension to deactivate'),
        },
        annotationsFor('aimeat_extension_deactivate'),
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
        descriptionFor('aimeat_extension_delete'),
        {
            name: z.string().describe('Name of the extension to delete'),
        },
        annotationsFor('aimeat_extension_delete'),
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
        descriptionFor('aimeat_extension_get'),
        {
            name: z.string().describe('Name of the extension to retrieve'),
        },
        annotationsFor('aimeat_extension_get'),
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
                        // Masked: an API surface returns the mask for a set secret, never the value.
                        config: maskSecretFields(ext.config, getExtSecretKeys(ext)),
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
