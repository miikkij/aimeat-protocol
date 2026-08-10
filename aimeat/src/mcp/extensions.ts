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
 *   v1.7.0 — 2026-08-10 — The sandbox context comes from buildExtensionCtx, and the paywall runs
 *                         here too. This door executed the script without asking, so a priced
 *                         action was free through a tool call and metered over HTTP. The wallet is
 *                         the shared one, so the per-call debit ceiling applies here as well.
 *   v1.6.0 — 2026-08-05 — aimeat_extension_invoke ctx gains files (makeExtensionFiles, parity with
 *     the REST door): file-storing actions (universe render/checkpoint) no longer answer
 *     UNAVAILABLE over MCP
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildExtensionRecordFromManifest } from '../routes/extensions/manifest.js';
import { reconcileAfterExtensionWrite } from '../services/exchange-projection.js';
import { getExtSecretKeys, getInstanceSecretKeys, decryptSecretFields, maskSecretFields, prepareSecretConfigForWrite } from '../services/extension-secrets.js';
import { getEncryptionKey } from '../services/encryption.js';
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import { executeExtensionAction } from '../services/extension-runtime.js';
import { buildExtensionCtx, buildExtensionWallet, buildExtensionNotify, unavailableEmail } from '../services/extension-ctx.js';
import { enforcePaywall } from '../routes/extensions/paywall.js';
import { createRefusalRecorder, refusalText } from '../routes/extensions/metered-response.js';
import { takeDesignations } from '../commerce/beneficiary-designation.js';
import type { ExtensionCtx } from '../services/extension-runtime.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { generateUploadToken, buildUploadMeta } from '../services/upload-token.js';
import { makeExtensionFiles } from '../services/extension-files.js';
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

            // The paywall, over MCP too. Cross-owner invocation is intended here (an extension is a
            // sellable capability, and getExtension resolves by name across owners), so the paywall
            // is what makes it safe: the owner and their own principals are free, everyone else
            // pays or holds an entitlement. This tool executed the script without asking, so a
            // priced action was free through a tool call and metered over HTTP.
            const refusal = createRefusalRecorder();
            const pay = await enforcePaywall({
                config, storage, ext, action, callerGaii: agentGaii, res: refusal,
                // An MCP session is an agent acting for its owner: no pay token, no internal pass,
                // no named app tool, and no app grant that would need spend permission.
                session: { roles: ['agent'], scopes: [], appGrantId: null },
            });
            if (!pay.ok) {
                return { content: [{ type: 'text' as const, text: refusal.refusal ? refusalText(refusal.refusal) : 'The call was refused.' }], isError: true };
            }

            // One builder for the sandbox context (services/extension-ctx.ts). Building it here by
            // hand is how this door came to differ from the HTTP one in four ways at once: no
            // charset detection beyond the header, a memory.set that ignored a request for a private
            // value and wrote public regardless, no email, and no paywall above.
            const ctx: ExtensionCtx = buildExtensionCtx({
                config, storage, extMemoryOwner,
                caller: {
                    gaii: agentGaii,
                    owner: parseGAII(agentGaii)?.owner ?? agentGaii,
                    roles: ['agent'],
                },
                // Decrypted for the VM as routes/extensions/actions.ts does; the { encrypted } wrapper would silently break the script.
                extConfig: decryptSecretFields(ext.config, getExtSecretKeys(ext), getEncryptionKey(config)),
                instance: instance_id ? {
                    id: instance_id,
                    config: decryptSecretFields((await storage.getExtensionInstance(extension_name, instance_id))?.config ?? {}, getInstanceSecretKeys(ext), getEncryptionKey(config)),
                } : undefined,
                logPrefix: `[ext:${ext.name}${instance_id ? ':' + instance_id : ''}]`,
                // Same ctx.files the REST door builds: reads are authorized as the caller, writes
                // land in the caller's own storage under ext/{name}/. Without it, an action that
                // stores a file works over REST and answers UNAVAILABLE over MCP.
                files: makeExtensionFiles({
                    config, storage,
                    callerGaii: agentGaii,
                    callerOwner: parseGAII(agentGaii)?.owner,
                    extName: ext.name,
                }),
                // The shared wallet, so this door has the per-call debit ceiling too. Its own copy
                // refused a negative amount but had no ceiling, which is the guard that bounds how
                // much a single call can take from the caller's balance.
                wallet: buildExtensionWallet({ config, storage, callerGaii: agentGaii, extName: ext.name }),
                notify: buildExtensionNotify({
                    storage, config, extName: ext.name,
                    recipientGaii: agentGaii,
                    recipientOwner: parseGAII(agentGaii)?.owner ?? agentGaii,
                }),
                // No SMTP identity belongs to an MCP session. Refusing with a logged false is the
                // behaviour every extension was written against; an absent capability would turn
                // ctx.email(...) into a TypeError inside the guest.
                email: unavailableEmail(ext.name, 'not available via MCP'),
            });

            try {
                const limits = {
                    memoryMb: Math.max(ext.limits.memoryMb, config.extensionMaxMemoryMb),
                    timeoutMs: Math.max(ext.limits.timeoutMs, config.extensionTimeoutMs),
                    maxApiCalls: Math.max(ext.limits.maxApiCalls, config.extensionMaxApiCalls),
                };
                const raw = await executeExtensionAction(action.scriptContent, ctx, input ?? {}, limits);

                emitResourceUpdated(agentGaii, `aimeat://extensions/${encodeURIComponent(extension_name)}`);

                // This door does NOT settle, so it accrues nothing — but it must still strip the
                // provider's beneficiary designation. The key is the seller's commercial business,
                // not a fact about the answer, and the REST door has always removed it. Leaving it
                // here would mean which door you came through decided whether you saw who the
                // seller shares its margin with.
                const { result } = takeDesignations(raw);

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
            // A caller who sent scripts plainly meant to install inline. Falling through to upload
            // mode here handed them an upload_url instead, dropped the scripts on the floor and said
            // nothing — so the "workaround" for a broken ZIP path silently became the ZIP path.
            if (!manifestYaml && scripts) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: 'Inline mode needs BOTH manifest and scripts — scripts were provided without a manifest, '
                            + 'so nothing was installed. Send the manifest YAML too, or omit scripts to get an upload URL for a ZIP.',
                    }],
                    isError: true,
                };
            }

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

            // Validation + record building is the SHARED builder that REST (POST/PUT /v1/extensions)
            // and the ZIP upload path use. This tool used to carry its own thinner copy, which is how
            // ODPS descriptors, commercial plans, instances validation and manifest field type-checking
            // ended up applying on some install paths and not others.
            const callerOwner = parseGAII(getAgentGaii())?.owner
                ?? (getAgentGaii().includes('@') ? getAgentGaii().split('@')[0] : 'mcp-agent');
            const built = buildExtensionRecordFromManifest(
                manifestYaml, scripts, config, callerOwner, new Date().toISOString(),
            );
            if (!built.ok) {
                return { content: [{ type: 'text' as const, text: `${built.code}: ${built.message}` }], isError: true };
            }
            const record = built.record;
            const name = record.name;

            const existingExt = await storage.getExtension(name);
            if (existingExt && !update) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" is already installed — pass update: true to upsert it in place (activation status and its ext: memory are preserved), or delete + reinstall.` }], isError: true };
            }
            if (existingExt && update) {
                // Only the installing owner may update their extension in place.
                if (existingExt.installedBy && existingExt.installedBy !== callerOwner) {
                    return { content: [{ type: 'text' as const, text: `Extension "${name}" was installed by "${existingExt.installedBy}" — only the installing owner may update it` }], isError: true };
                }
            }

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
                    // Never answer a write that did not apply with the record we WANTED to store.
                    // This line used to be `updated ?? { ...record, status }`, which reported the NEW
                    // version number while the database still held the old code — the most misleading
                    // answer available, because it looks like proof the deploy worked.
                    if (!updated) {
                        logger.error(`Extension upsert wrote nothing via MCP: ${name}`, { by: record.installedBy });
                        return {
                            content: [{ type: 'text' as const, text: `Extension "${name}" was NOT updated — the storage write did not apply, and the installed version is unchanged. Nothing was deployed.` }],
                            isError: true,
                        };
                    }
                    result = updated;
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
                // Re-project any EXCHANGE listings the actions declare (price/flag may have changed) —
                // parity with POST/PUT /v1/extensions, which have always done this.
                await reconcileAfterExtensionWrite(storage, record.installedBy, config.nodeId, name);
                // Actions may have changed (or just went live) — refresh aggregated capabilities.
                if (status === 'active') {
                    import('../services/capability-aggregator.js')
                        .then(m => m.runCapabilityAggregation(config, storage))
                        .catch(err => logger.error('Capability aggregation after MCP extension install failed', { error: String(err) }));
                }

                // An ACTIVE extension whose manifest declares schedules needs a schedule
                // re-registration this tool cannot perform — point at the REST upsert.
                const manifestSchedules = record.config.__schedules as unknown[] | undefined;
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
                    .catch(err => logger.error('Capability aggregation after MCP extension activate failed', { error: String(err) }));

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
