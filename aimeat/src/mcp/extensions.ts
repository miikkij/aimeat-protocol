/**
 * @file extensions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP extension tools and resource registrations. Provides 8 tools for extension
 *   lifecycle management (list, invoke, install, activate, config_set, deactivate, delete, get) and 1
 *   resource template for reading extension details via the MCP resource protocol.
 * @structure
 *   - registerExtensionsTools() — registers all extension tools and resources on an McpServer instance
 * @usage
 *   import { registerExtensionsTools } from './extensions.js';
 *   registerExtensionsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged, scopes, caller, getToken);
 * @version-history
 *   2026-10-25 — aimeat_extension_install asks the install rule before it hands out an upload URL, and a refusal by the install role names the setting and the operator (secaudit2026oct22 lead 128).
 *   2026-10-25 — aimeat_extension_get answers installed_by_principal, the principal that wrote the code, as the REST detail does (secaudit2026oct22 lead 98, transparency).
 *   2026-10-25 — aimeat_extension_config_set tells the service whether the agent may choose a secret's host (secaudit2026oct22).
 *   2026-10-25 — aimeat_extension_install with update: true asks the manage rule as a code write (writesCode) (secaudit2026oct22).
 *   2026-10-25 — aimeat_extension_config_set tells the service whether the caller is an operator caller: only one sets emailPolicy (secaudit2026oct22).
 *   2026-10-24 — aimeat_extension_invoke no longer hands the session's bearer to the run: ctx.buy runs
 *     the seller's action for the buying extension's GEAI (secaudit2026oct22,
 *     ext-purchase:buy-forwards-outer-caller-bearer).
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-21 — aimeat_extension_get answers `uses_secrets`: which vault secrets the scripts send where.
 *   v2.10.0 — 2026-10-20 — aimeat_extension_unattended_reader: what an extension may read with nobody
 *     present. READ ONLY, because the write is the person's own decision and takes
 *     requireOwnerPrincipal; the answer carries where they make it (Jouni, 2026-10-20).
 *   2026-10-16 — aimeat_extension_invoke runs services/extension-invoke.ts, the sequence
 *     POST /v1/ext/:extName/:actionId runs: the error text is redacted of credential-shaped text, the
 *     call duration and count are recorded, a version pin (name@version) resolves, the app membership
 *     and ctx.buy reach the script, and a refusal reads `CODE: message` (QA audit D2-05).
 *   2026-10-16 — A catch-all failure carries the caught error (withCaughtError, mcp/tool-fault.ts): an internal exception is logged, reported and answered with a sentence instead of its text (QA audit E5-01, D2-01).
 *   v2.9.1 — 2026-10-09 — aimeat_extension_invoke decrypts secret config for the field it is bound to
 *     (SecretBinding; secrets audit 2026-10-09, 1.1).
 *   v2.9.0 — 2026-10-09 — aimeat_extension_config_set (services/extension-config-set.ts).
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v2.8.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2).
 *   v2.7.0 — 2026-10-05 — The action run passes the extension's capabilities to buildExtensionCtx
 *     (secaudit 2026-10, PKG-3).
 *   v2.6.0 — 2026-10-01 — aimeat_iam_define takes default_role, version, author and ext_name and passes
 *     them to defineAppIam (audit 2026-10-01, defect B).
 *   v2.5.0 — 2026-09-29 — ctx.files is told the caller is this session's agent, so a file read
 *     passes the classification check as an AI (TARGET-082 V4).
 *   v2.4.2 — 2026-09-26 — The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 *   v2.4.1 — 2026-09-13 — An install refusal carries its details (ODPS_FIELD_TOO_LONG names the field,
 *     its length, the cap and the room left).
 *   v2.4.0 — 2026-09-13 — aimeat_extension_get takes include_source and returns each action's
 *     script_content past the installer check GET /v1/extensions/:name?full=true applies. The scripts
 *     were readable over HTTP only, so an agent extending its own installed extension had to rebuild
 *     every existing action from memory.
 *   v2.3.0 — 2026-09-06 — aimeat_extension_invoke passes the session's scopes into ctx.caller, as
 *     the HTTP door does, so a script holding a permission word answers the same on both surfaces.
 *   v2.2.0 — 2026-09-05 — aimeat_extension_invoke attaches ctx.workspace when the manifest declares
 *     it, as the session's agent with the session's scopes (services/extension-workspace.ts), so
 *     an action that keeps a shared workspace record works through this door as it does over HTTP.
 *   v2.1.0 — 2026-09-03 — extension_list carries installed_by and used_by; extension_get carries used_by (the dependency map).
 *   v2.0.0 — 2026-08-11 — Install, activate, deactivate and delete go through
 *     services/extension-lifecycle.ts instead of calling storage here. Four side effects the HTTP
 *     door has always had were missing on this one: deleting removed the row and left the scheduled
 *     jobs and the whole ext: namespace behind, activating never registered the manifest's schedules
 *     or ran its @activate jobs, deactivating left the cron firing, and a redeploy of an identical
 *     manifest re-ran the extension's initialisation instead of answering "unchanged".
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
 *   v1.9.0 — 2026-08-11 — The two money steps that ran after the paywall on the HTTP door only:
 *     the refund when a paid script throws, and the accrual of the provider's beneficiary
 *     designation. The same failure cost the buyer through one door and nothing through the
 *     other, and a promised revenue share was credited for HTTP calls and not for agent calls.
 *   v1.8.0 — 2026-08-11 — The install ceilings (node-wide and per-owner) that POST/PUT /v1/extensions
 *     have always applied, the shared ownership rule instead of a local copy that read an empty
 *     installedBy as permission, and sandboxLimits for the invoke path.
 *   v1.7.0 — 2026-08-10 — The sandbox context comes from buildExtensionCtx, and the paywall runs
 *                         here too. This door executed the script without asking, so a priced
 *                         action was free through a tool call and metered over HTTP. The wallet is
 *                         the shared one, so the per-call debit ceiling applies here as well.
 *   v1.6.0 — 2026-08-05 — aimeat_extension_invoke ctx gains files (makeExtensionFiles, parity with
 *     the REST door): file-storing actions (universe render/checkpoint) no longer answer
 *     UNAVAILABLE over MCP
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { withCaughtError } from './tool-fault.js';
import { buildExtensionRecordFromManifest } from '../services/extension-manifest.js';
import { getExtSecretKeys, maskSecretFields } from '../services/extension-secrets.js';
import { usesSecretsOf } from '../services/extension-secret-uses.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { enforcePaywall } from '../routes/extensions/paywall.js';
import { createRefusalRecorder, refusalText } from '../routes/extensions/metered-response.js';
import { localAccountName } from '../utils/gaii.js';
import { invokeExtensionAction } from '../services/extension-invoke.js';
import { capabilitiesOfRecord } from '../services/extension-capability-declaration.js';
import { canManageExtensionAs, installRoleRefusal, type ExtensionCaller } from '../routes/extensions/permissions.js';
import { isOperatorCaller } from '../services/operator-override.js';
import {
    writeExtensionRecord, activateExtension, deactivateExtension, uninstallExtension,
} from '../services/extension-lifecycle.js';
import { getActiveScheduler } from '../services/scheduler.js';
import { logger } from '../utils/logger.js';
import { generateUploadToken, buildUploadMeta } from '../services/upload-token.js';
import { annotationsFor } from './annotations.js';
import { dependencyIndex, dependentsOf, visibleAppRefs, usedBySummary } from '../services/dependency-map.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { defineAppIam } from '../services/iam/define-app-iam.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';
import { setExtensionConfig, mayChooseSecretHost } from '../services/extension-config-set.js';
import { readAuthorityOf, readAuthorityPayload } from '../services/extension-read-authority.js';
import { toolError } from './tool-error.js';

export function registerExtensionsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
    /** The session's own scopes. Unused here: the session caller below carries them. */
    _sessionScopes: string[] = [],
    /** The session's caller (services/caller-context.ts), for the ownership guard on
     *  activate/deactivate/delete and the caller an action runs as. */
    caller: () => CallerContext,
    /** The session's current bearer. Unused: ctx.buy runs the seller's action for the buying
     *  extension's own GEAI and takes no credential of this session (secaudit2026oct22). */
    _getToken?: () => string | undefined,
): void {
    const agentGaii = getAgentGaii();
    /** The caller's owner GHII, the key the app listing decides visibility by. */
    const viewerGhii = () => { const o = localAccountName(agentGaii); return o ? `${o}@${config.nodeId}` : undefined; };
    /** The dependants of one extension, with the names of apps this caller may see. */
    const usedByFor = async (name: string) => {
        const { visible } = await visibleAppRefs(storage, viewerGhii());
        return usedBySummary(await dependentsOf(storage, 'extension', name), visible);
    };

    /**
     * The caller, in the shape canManageExtensionAs() and the install caps expect.
     *
     * The role stays 'agent' and nothing else. An MCP session is always an agent record
     * (mcp/index.ts:346), and the current connect path — device authorization — issues a token
     * carrying exactly ['agent'] (routes/agents/device-auth.ts:152). The owner's roles are not
     * copied here: the operator's reach is asked of the session (isOperatorCaller, inside
     * canManageExtensionAs), so only an operator's agent holding operator:admin carries it, the same
     * answer REST gives. The session caller's `auth` view, so the call sites cannot drift apart.
     */
    function resolveCaller(): ExtensionCaller {
        return caller().auth;
    }

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
    mcp.registerTool(
        'aimeat_extension_list',
        {
            description: descriptionFor('aimeat_extension_list'),
            inputSchema: zodShapeFor('aimeat_extension_list'),
            annotations: annotationsFor('aimeat_extension_list'),
        },
        async () => {
            const extensions = await storage.listExtensions();
            const active = extensions.filter(e => e.status === 'active');
            // Who uses each one, from the dependency map — the same rows GET /v1/extensions carries,
            // so an agent deciding whether to build or reuse reads what the page reads.
            const deps = await dependencyIndex(storage);
            const { visible } = await visibleAppRefs(storage, viewerGhii());
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(active.map(ext => ({
                        name: ext.name,
                        version: ext.version,
                        description: ext.description,
                        author: ext.author,
                        installed_by: ext.installedBy,
                        used_by: usedBySummary(deps.byExtension.get(ext.name), visible),
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
    mcp.registerTool(
        'aimeat_iam_define',
        {
            description: descriptionFor('aimeat_iam_define'),
            inputSchema: zodShapeFor('aimeat_iam_define'),
            annotations: annotationsFor('aimeat_iam_define'),
        },
        async ({ app_id, levels, commands, default_role, version, author, ext_name }) => {
            const result = defineAppIam({
                appId: app_id, levels, commands, defaultRole: default_role, version, author, extName: ext_name,
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    // ── Tool 2: aimeat_extension_invoke ──
    // The sequence is services/extension-invoke.ts, the one POST /v1/ext/:extName/:actionId runs:
    // the version pin, the app membership, the paywall, the sandbox context with ctx.buy, the refund,
    // the call duration and count, the accrual and the redacted failure text. This tool renders the
    // answer as text. Cross-owner invocation is intended (an extension is a sellable capability), and
    // the paywall inside the sequence is what makes it safe.
    mcp.registerTool(
        'aimeat_extension_invoke',
        {
            description: descriptionFor('aimeat_extension_invoke'),
            inputSchema: zodShapeFor('aimeat_extension_invoke'),
            annotations: annotationsFor('aimeat_extension_invoke'),
        },
        async ({ extension_name, action_id, input, instance_id }) => {
            const session = caller();
            // A paywall refusal is recorded, not sent, and rendered below in the tool's own words.
            const refusal = createRefusalRecorder();
            const out = await invokeExtensionAction({
                config, storage, enforcePaywall,
                extRef: extension_name,
                instanceId: instance_id || undefined,
                actionId: action_id,
                input: input ?? {},
                // An MCP session is an agent acting for its owner: no pay token, no internal pass, no
                // named app tool and no app grant. Its roles and scopes are the session's.
                caller: {
                    gaii: session.principal, metered: session.principal, owner: session.owner, kind: session.kind,
                    roles: [...session.roles], scopes: [...session.scopes], appGrantId: null,
                },
                paywall: { res: refusal },
            });
            if (out.kind === 'paywall') {
                return { content: [{ type: 'text' as const, text: refusal.refusal ? refusalText(refusal.refusal) : 'The call was refused.' }], isError: true };
            }
            if (out.kind === 'refused') return { ...toolError(out.code, out.message) };
            emitResourceUpdated(agentGaii, `aimeat://extensions/${encodeURIComponent(out.extName)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(out.result, null, 2) }] };
        },
    );

    // ── Tool 3: aimeat_extension_install ──
    mcp.registerTool(
        'aimeat_extension_install',
        {
            description: descriptionFor('aimeat_extension_install'),
            inputSchema: zodShapeFor('aimeat_extension_install'),
            annotations: annotationsFor('aimeat_extension_install'),
        },
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
                // The upload URL is an install, so the install rule is asked before it is handed out,
                // as the inline mode below asks it: the install role included (installRoleRefusal).
                const minter = resolveCaller();
                if (!(await canManageExtensionAs(storage, config, minter, minter.owner, { action: 'install', subject: '(upload)' }))) {
                    const byRole = await installRoleRefusal(storage, config, minter.owner);
                    return { content: [{ type: 'text' as const, text: byRole ?? 'Installing an extension needs the ext:write permission, which this session does not carry.' }], isError: true };
                }
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
            const caller = resolveCaller();
            const callerOwner = caller.owner;
            const isOperator = await isOperatorCaller(storage, caller);
            const built = buildExtensionRecordFromManifest(
                manifestYaml, scripts, config, callerOwner, new Date().toISOString(), isOperator,
            );
            if (!built.ok) {
                return { content: [{ type: 'text' as const, text: `${built.code}: ${built.message}` }], isError: true };
            }
            // The write permission, checked HERE and not only by the registration filter. That filter
            // is warn-only when AIMEAT_MCP_ENFORCE_SCOPES=false, and in that mode this tool installed
            // executable extension code with no permission check at all. routes/extensions/crud.ts
            // checks it in the handler for the same reason.
            if (!(await canManageExtensionAs(storage, config, caller, callerOwner, { action: 'install', subject: built.record.name }))) {
                const byRole = await installRoleRefusal(storage, config, callerOwner);
                return { content: [{ type: 'text' as const, text: byRole ?? 'Installing an extension needs the ext:write permission, which this session does not carry.' }], isError: true };
            }

            const record = built.record;
            const name = record.name;
            const scheduler = getActiveScheduler();

            const existingExt = await storage.getExtension(name);
            if (existingExt && !update) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" is already installed — pass update: true to upsert it in place (activation status and its ext: memory are preserved), or delete + reinstall.` }], isError: true };
            }
            if (existingExt && update) {
                // Only the installing owner may update their extension in place. The rule is the
                // shared one, not a local retelling of it: the local version read an EMPTY
                // installedBy as permission, so an imported or legacy record could be overwritten
                // in place by any agent holding ext:write. canManageExtensionAs compares owners
                // directly, which refuses an empty installer to everyone but an operator.
                if (!(await canManageExtensionAs(storage, config, caller, existingExt.installedBy, { action: 'update', subject: name, writesCode: true }))) {
                    return { content: [{ type: 'text' as const, text: `Extension "${name}" was installed by "${existingExt.installedBy || 'an unknown installer'}" — only the installing owner may update it` }], isError: true };
                }
            }

            try {
                // The whole write is services/extension-lifecycle.ts: the node-wide and per-owner
                // install ceilings, the secret encryption (this path once wrote config straight to
                // storage, so a `type: secret` value was persisted in the clear), the no-op shortcut
                // for an identical manifest, the in-place swap with its schedule re-registration, and
                // the EXCHANGE re-projection. Writing any of that out here is how the two doors came
                // to disagree in the first place.
                const written = await writeExtensionRecord({ storage, config, scheduler }, record, {
                    existing: existingExt ?? null,
                    ownerName: callerOwner,
                    actor: agentGaii,
                    isOperator,
                });
                if (!written.ok) {
                    return { content: [{ type: 'text' as const, text: `${written.code}: ${written.message}${written.details ? `\n${JSON.stringify(written.details)}` : ''}` }], isError: true };
                }
                const result = written.record;
                logger.info(`Extension ${written.action} via MCP: ${result.name}`, {
                    version: result.version, by: record.installedBy, reinitialized: written.reinitialized,
                });

                // Optional immediate activation (skips the separate activate call). The shared
                // activation registers the manifest's schedules and runs its @activate jobs, which
                // the status write here never did.
                let status = result.status;
                if (activate && status !== 'active') {
                    const activated = await activateExtension({ storage, config, scheduler }, result, agentGaii);
                    status = activated?.status ?? 'active';
                }
                // Actions may have changed (or just went live) — refresh aggregated capabilities.
                if (status === 'active') {
                    import('../services/capability-aggregator.js')
                        .then(m => m.runCapabilityAggregation(config, storage))
                        .catch(err => logger.error('Capability aggregation after MCP extension install failed', { error: String(err) }));
                }

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            name: result.name,
                            version: result.version,
                            status,
                            action: written.action,
                            actions: result.actions.map(a => ({ id: a.id, method: a.method, path: a.path })),
                            // What the manifest lost or what the sandbox cannot do. The HTTP door has
                            // always returned these; an author installing through an agent learned
                            // nothing, so a stripped emailPolicy or a Math.random() went unmentioned.
                            ...(built.warnings?.length ? { warnings: built.warnings } : {}),
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return withCaughtError({ content: [{ type: 'text' as const, text: `Failed to ${update ? 'update' : 'install'} extension: ${(err as Error).message}` }], isError: true }, err);
            }
        },
    );

    // ── Tool 4: aimeat_extension_activate ──
    mcp.registerTool(
        'aimeat_extension_activate',
        {
            description: descriptionFor('aimeat_extension_activate'),
            inputSchema: zodShapeFor('aimeat_extension_activate'),
            annotations: annotationsFor('aimeat_extension_activate'),
        },
        async ({ name }) => {
            const ext = await storage.getExtension(name);
            if (!ext) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" not found` }], isError: true };
            }

            // Only the installer may activate their extension. This tool had no ownership check at
            // all, so any agent holding ext:write reached every extension on the node — including
            // another owner's. routes/extensions/crud.ts has refused that since it was written, via
            // canManageInstalledExt; that function needed an Express request, so the surface without
            // one never called it. Same rule, same wording: not found rather than not yours.
            if (!(await canManageExtensionAs(storage, config, resolveCaller(), ext.installedBy, { action: 'activate', subject: name }))) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" not found` }], isError: true };
            }

            try {
                // Activating is three things: the status, the schedules the manifest declares, and
                // the @activate jobs that do the extension's first run. This tool wrote the status
                // and stopped, so an extension switched on by an agent never started its clock —
                // it looked installed, active and idle. One implementation, in
                // services/extension-lifecycle.ts.
                const updated = await activateExtension(
                    { storage, config, scheduler: getActiveScheduler() }, ext, getAgentGaii(),
                );

                // Trigger capability aggregation so the extension appears immediately
                import('../services/capability-aggregator.js')
                    .then(m => m.runCapabilityAggregation(config, storage))
                    .catch(err => logger.error('Capability aggregation after MCP extension activate failed', { error: String(err) }));

                logger.info(`Extension activated via MCP: ${name}`, { by: getAgentGaii() });

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            name,
                            status: updated?.status ?? 'active',
                            activated_at: updated?.activatedAt ?? null,
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return withCaughtError({ content: [{ type: 'text' as const, text: `Failed to activate extension: ${(err as Error).message}` }], isError: true }, err);
            }
        },
    );

    // ── aimeat_extension_config_set: PATCH /v1/extensions/:name/config, one service ──
    mcp.registerTool(
        'aimeat_extension_config_set',
        {
            description: descriptionFor('aimeat_extension_config_set'),
            inputSchema: zodShapeFor('aimeat_extension_config_set'),
            annotations: annotationsFor('aimeat_extension_config_set'),
        },
        async ({ name, config: values }) => {
            const ext = await storage.getExtension(name);
            const caller = resolveCaller();
            if (!ext || !(await canManageExtensionAs(storage, config, caller, ext.installedBy, { action: 'update', subject: name }))) {
                return { ...toolError('NOT_FOUND', `Extension "${name}" not found`) };
            }
            const out = await setExtensionConfig({ storage, config }, ext, values, {
                isOperator: await isOperatorCaller(storage, caller),
                mayChooseSecretHosts: mayChooseSecretHost({ roles: caller.roles, scopes: caller.scopes, principal: agentGaii }),
            });
            if (!out.ok) return { ...toolError(out.code, out.message) };
            const hosts = capabilitiesOfRecord(out.record).hosts;
            return { content: [{ type: 'text' as const, text: JSON.stringify({
                name, changed: out.changed,
                config: maskSecretFields(out.record.config, getExtSecretKeys(out.record)),
                ...(hosts ? { network_hosts: hosts } : {}),
            }, null, 2) }] };
        },
    );

    // ── aimeat_extension_unattended_reader: GET /v1/extensions/:name/unattended-reader ──
    // READ ONLY, and there is no companion set tool on purpose: the write is the person's own
    // decision about their own data and takes requireOwnerPrincipal, which no MCP session holds.
    // The answer carries where they change it, so the agent can hand that to them in chat
    // (routes/extensions/unattended-reader.ts says why read and write take different gates).
    mcp.registerTool(
        'aimeat_extension_unattended_reader',
        {
            description: descriptionFor('aimeat_extension_unattended_reader'),
            inputSchema: zodShapeFor('aimeat_extension_unattended_reader'),
            annotations: annotationsFor('aimeat_extension_unattended_reader'),
        },
        async ({ name }) => {
            // readAuthorityOf, not storage.getExtension: the service owns this question on both
            // surfaces, so neither reads the record for itself (pnpm check:shared-impl).
            const found = await readAuthorityOf({ storage }, name);
            if (!found || !(await canManageExtensionAs(storage, config, resolveCaller(), found.ext.installedBy, { action: 'read', subject: name }))) {
                return { ...toolError('NOT_FOUND', `Extension "${name}" not found`) };
            }
            const payload = readAuthorityPayload(name, found.view);
            return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
        },
    );

    // ── Tool 5: aimeat_extension_deactivate ──
    mcp.registerTool(
        'aimeat_extension_deactivate',
        {
            description: descriptionFor('aimeat_extension_deactivate'),
            inputSchema: zodShapeFor('aimeat_extension_deactivate'),
            annotations: annotationsFor('aimeat_extension_deactivate'),
        },
        async ({ name }) => {
            const ext = await storage.getExtension(name);
            if (!ext) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" not found` }], isError: true };
            }

            // Only the installer may deactivate their extension. This tool had no ownership check at
            // all, so any agent holding ext:write reached every extension on the node — including
            // another owner's. routes/extensions/crud.ts has refused that since it was written, via
            // canManageInstalledExt; that function needed an Express request, so the surface without
            // one never called it. Same rule, same wording: not found rather than not yours.
            if (!(await canManageExtensionAs(storage, config, resolveCaller(), ext.installedBy, { action: 'deactivate', subject: name }))) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" not found` }], isError: true };
            }

            try {
                // The status and the scheduled jobs together. This tool wrote only the status, so a
                // deactivated extension kept firing on its cron until somebody deactivated it again
                // over HTTP.
                await deactivateExtension({ storage, config, scheduler: getActiveScheduler() }, name);

                logger.info(`Extension deactivated via MCP: ${name}`, { by: getAgentGaii() });

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ name, status: 'inactive' }, null, 2),
                    }],
                };
            } catch (err) {
                return withCaughtError({ content: [{ type: 'text' as const, text: `Failed to deactivate extension: ${(err as Error).message}` }], isError: true }, err);
            }
        },
    );

    // ── Tool 6: aimeat_extension_delete ──
    mcp.registerTool(
        'aimeat_extension_delete',
        {
            description: descriptionFor('aimeat_extension_delete'),
            inputSchema: zodShapeFor('aimeat_extension_delete'),
            annotations: annotationsFor('aimeat_extension_delete'),
        },
        async ({ name }) => {
            const ext = await storage.getExtension(name);
            if (!ext) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" not found` }], isError: true };
            }

            // Only the installer may delete their extension. This tool had no ownership check at
            // all, so any agent holding ext:write reached every extension on the node — including
            // another owner's. routes/extensions/crud.ts has refused that since it was written, via
            // canManageInstalledExt; that function needed an Express request, so the surface without
            // one never called it. Same rule, same wording: not found rather than not yours.
            if (!(await canManageExtensionAs(storage, config, resolveCaller(), ext.installedBy, { action: 'delete', subject: name }))) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" not found` }], isError: true };
            }

            try {
                // The row is not the extension. Its scheduled jobs, its `ext:{name}` memory and each
                // instance's `ext:{name}.{id}` memory go with it — which this tool did not do, so an
                // extension uninstalled by an agent left cron jobs firing against a name that no
                // longer resolved and left its data unreachable. DELETE /v1/extensions/:name has
                // cleaned all three since it was written; both doors now call the same function.
                await uninstallExtension({ storage, config, scheduler: getActiveScheduler() }, name);

                logger.info(`Extension deleted via MCP: ${name}`, { by: getAgentGaii() });

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ name, deleted: true }, null, 2),
                    }],
                };
            } catch (err) {
                return withCaughtError({ content: [{ type: 'text' as const, text: `Failed to delete extension: ${(err as Error).message}` }], isError: true }, err);
            }
        },
    );

    // ── Tool 7: aimeat_extension_get ──
    mcp.registerTool(
        'aimeat_extension_get',
        {
            description: descriptionFor('aimeat_extension_get'),
            inputSchema: zodShapeFor('aimeat_extension_get'),
            annotations: annotationsFor('aimeat_extension_get'),
        },
        async ({ name, include_source }) => {
            const ext = await storage.getExtension(name);
            if (!ext) {
                return { content: [{ type: 'text' as const, text: `Extension "${name}" not found` }], isError: true };
            }

            // The source is the whole implementation of somebody's extension, and GET
            // /v1/extensions/:name?full=true answers it only past canManageInstalledExt. Same rule
            // here, through the request-free half of it: the installer's own principal holding
            // ext:write, or an operator. Refused outright rather than answered without the scripts,
            // because an answer that lacks what was asked for, and says nothing, reads as "this action has no code".
            if (include_source && !(await canManageExtensionAs(storage, config, resolveCaller(), ext.installedBy, { action: 'read-source', subject: name }))) {
                return { content: [{ type: 'text' as const, text: `The source of extension "${name}" is readable only by its installer's own sessions holding ext:write.` }], isError: true };
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
                            // Adding an action means redeploying the whole manifest with every script,
                            // and until 2026-09-13 no MCP door could read the scripts back.
                            ...(include_source ? { script_content: a.scriptContent } : {}),
                        })),
                        // Masked: an API surface returns the mask for a set secret, never the value.
                        config: maskSecretFields(ext.config, getExtSecretKeys(ext)),
                        limits: ext.limits,
                        federation: ext.federation,
                        instances: ext.instances,
                        installed_by: ext.installedBy,
                        // Which principal wrote the code (the person, or which of their agents): public
                        // provenance, as GET /v1/extensions/:name answers it (Jouni, 2026-10-25).
                        installed_by_principal: ext.installedByPrincipal ?? null,
                        // Which vault secrets the scripts send where, and why (services/extension-secret-uses.ts).
                        uses_secrets: usesSecretsOf(ext.config),
                        installed_at: ext.installedAt,
                        activated_at: ext.activatedAt,
                        used_by: await usedByFor(name),
                    }, null, 2),
                }],
            };
        },
    );
}
