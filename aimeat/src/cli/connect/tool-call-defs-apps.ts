/**
 * @file cli/connect/tool-call-defs-apps.ts
 * @description App-fork, IAM, organism-archive, workspace-transfer, wallet, app, extension, cortex and workflow connect-call tool definitions. Extracted from cli/connect/tool-call.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 -- 2026-07-13 -- Extracted from tool-call.ts (max-file-lines)
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalNumber, requiredArray, requiredRecord, optionalRecord } from './tool-call-helpers.js';
import type { ApiResponse } from './api-client.js';
import { defineAppIam } from '../../services/iam/define-app-iam.js';
import type { LevelDef } from '../../services/iam/model.js';
import type { CommandDef } from '../../services/iam/app-commands.js';

export const appTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_app_fork',
        handler: ({ client }, input) => {
            const owner = requiredString(input, 'owner');
            const filename = requiredString(input, 'filename');
            const body: JsonObject = { new_filename: requiredString(input, 'new_filename') };
            const version = optionalNumber(input, 'version'); if (version !== undefined) body.version = version;
            return client.post(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/fork`, body);
        },
    },
    {
        // Pure local computation (validate + design an app IAM level/command schema) — no node round-trip.
        // The design helper is a pure function shared with the MCP tool, so the shell result is identical.
        name: 'aimeat_iam_define',
        handler: async (_ctx, input) => {
            const result = defineAppIam({
                appId: optionalString(input, 'app_id'),
                levels: requiredArray(input, 'levels') as LevelDef[],
                commands: requiredArray(input, 'commands') as CommandDef[],
            });
            return result.ok === false
                ? { ok: false as const, error: { code: 'IAM_INVALID', message: (result as { error: string }).error } }
                : { ok: true as const, data: result as unknown as JsonObject };
        },
    },
    {
        name: 'aimeat_organism_archive',
        handler: ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const action = requiredString(input, 'action') === 'unarchive' ? 'unarchive' : 'archive';
            const body: JsonObject = { level: requiredString(input, 'level') };
            const ws = optionalString(input, 'ws'); if (ws) body.ws = ws;
            const namespace = optionalString(input, 'namespace'); if (namespace) body.namespace = namespace;
            const key = optionalString(input, 'key'); if (key) body.key = key;
            return client.post(`/v1/organisms/${encodeURIComponent(orgId)}/${action}`, body);
        },
    },
    {
        name: 'aimeat_workspace_transfer',
        handler: ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const direction = requiredString(input, 'direction');
            if (direction === 'export') return client.get(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/export${query({ ws: requiredString(input, 'ws'), format: 'base64' })}`);
            if (direction === 'import') return client.post(`/v1/organisms/${encodeURIComponent(orgId)}/workspace/import`, { zip_base64: requiredString(input, 'zip_base64') });
            throw new Error("direction must be 'export' or 'import'.");
        },
    },
    {
        name: 'aimeat_wallet_transactions',
        handler: ({ client }, input) => client.get(`/v1/wallet/transactions${query({ limit: optionalNumber(input, 'limit') })}`),
    },
    {
        name: 'aimeat_app_publish',
        description: 'Publish an app package.',
        input: {
            name: { type: 'string', required: true, description: 'App name.' },
            description: { type: 'string', required: true, description: 'App description.' },
            content: { type: 'string', required: true, description: 'App content.' },
        },
        handler: ({ client }, input) => client.post('/v1/packages', {
            name: requiredString(input, 'name'),
            description: requiredString(input, 'description'),
            content: requiredString(input, 'content'),
        }),
    },
    {
        name: 'aimeat_app_list',
        description: 'List available apps.',
        input: { query: { type: 'string', description: 'Search query.' } },
        handler: ({ client }, input) => client.get(`/v1/packages${query({ q: optionalString(input, 'query') })}`),
    },
    {
        name: 'aimeat_app_get',
        description: 'Get app detail by group ID.',
        input: { group_id: { type: 'string', required: true, description: 'App group identifier.' } },
        handler: ({ client }, input) => client.get(`/v1/packages/${encodeURIComponent(requiredString(input, 'group_id'))}`),
    },
    {
        name: 'aimeat_app_delete',
        description: 'Archive an app version.',
        input: {
            group_id: { type: 'string', required: true, description: 'App group identifier.' },
            version: { type: 'string', required: true, description: 'Version to archive.' },
        },
        handler: ({ client }, input) => client.delete(`/v1/packages/${encodeURIComponent(requiredString(input, 'group_id'))}/versions/${encodeURIComponent(requiredString(input, 'version'))}`),
    },
    {
        name: 'aimeat_app_versions',
        description: 'List app version history.',
        input: { group_id: { type: 'string', required: true, description: 'App group identifier.' } },
        handler: ({ client }, input) => client.get(`/v1/packages/${encodeURIComponent(requiredString(input, 'group_id'))}/versions`),
    },
    {
        name: 'aimeat_extension_list',
        description: 'List installed extensions.',
        input: {},
        handler: ({ client }) => client.get('/v1/extensions'),
    },
    {
        name: 'aimeat_extension_invoke',
        description: 'Invoke an extension action.',
        input: {
            name: { type: 'string', required: true, description: 'Extension name.' },
            action_id: { type: 'string', required: true, description: 'Action identifier.' },
            input: { type: 'object', description: 'Input parameters.' },
        },
        handler: ({ client }, input) => client.post(
            `/v1/ext/${encodeURIComponent(requiredString(input, 'name'))}/${encodeURIComponent(requiredString(input, 'action_id'))}`,
            optionalRecord(input, 'input') ?? {},
        ),
    },
    {
        name: 'aimeat_extension_install',
        description: 'Install an extension from a manifest.',
        input: {
            name: { type: 'string', required: true, description: 'Extension name.' },
            manifest: { type: 'object', required: true, description: 'Extension manifest object.' },
        },
        handler: ({ client }, input) => client.post('/v1/extensions', {
            name: requiredString(input, 'name'),
            manifest: requiredRecord(input, 'manifest'),
        }),
    },
    {
        name: 'aimeat_extension_activate',
        description: 'Activate an installed extension.',
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
        handler: ({ client }, input) => client.post(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}/activate`),
    },
    {
        name: 'aimeat_extension_deactivate',
        description: 'Deactivate an extension.',
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
        handler: ({ client }, input) => client.post(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}/deactivate`),
    },
    {
        name: 'aimeat_extension_delete',
        description: 'Uninstall an extension.',
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
        handler: ({ client }, input) => client.delete(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}`),
    },
    {
        name: 'aimeat_extension_get',
        description: 'Get extension details.',
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
        handler: ({ client }, input) => client.get(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}`),
    },
    {
        name: 'aimeat_cortex_list',
        description: 'List installed cortex models.',
        input: {},
        handler: ({ client }) => client.get('/v1/cortex'),
    },
    {
        name: 'aimeat_cortex_install',
        description: 'Install a cortex model from a manifest.',
        input: {
            name: { type: 'string', required: true, description: 'Cortex name.' },
            manifest: { type: 'object', required: true, description: 'Cortex manifest object.' },
        },
        handler: ({ client }, input) => client.post('/v1/cortex', {
            name: requiredString(input, 'name'),
            manifest: requiredRecord(input, 'manifest'),
        }),
    },
    {
        name: 'aimeat_cortex_activate',
        description: 'Activate a cortex model.',
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
        handler: ({ client }, input) => client.post(`/v1/cortex/${encodeURIComponent(requiredString(input, 'name'))}/activate`),
    },
    {
        name: 'aimeat_cortex_deactivate',
        description: 'Deactivate a cortex model.',
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
        handler: ({ client }, input) => client.post(`/v1/cortex/${encodeURIComponent(requiredString(input, 'name'))}/deactivate`),
    },
    {
        name: 'aimeat_cortex_delete',
        description: 'Delete a cortex model.',
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
        handler: ({ client }, input) => client.delete(`/v1/cortex/${encodeURIComponent(requiredString(input, 'name'))}`),
    },
    // ── Agent Workflows (shell-callable parity with the MCP + connector surfaces) ──
    {
        name: 'aimeat_workflow_save',
        description: 'Create/update a workflow. `definition` is the full descriptor (title, description, trigger, vars[], steps[], on_step_fail, llm?); validated against the offer contract + DAG on save.',
        input: {
            id: { type: 'string', required: true, description: 'Workflow id (lowercase slug); existing id = update.' },
            definition: { type: 'object', required: true, description: 'The workflow descriptor.' },
        },
        handler: ({ client }, input) => client.put(`/v1/workflows/${encodeURIComponent(requiredString(input, 'id'))}`, requiredRecord(input, 'definition')),
    },
    {
        name: 'aimeat_workflow_get',
        description: 'Inspect workflows. Omit id to list; pass an id for its definition + derived blueprint + recent runs.',
        input: { id: { type: 'string', description: 'Omit to list; pass for one workflow.' } },
        handler: async ({ client }, input) => {
            const id = optionalString(input, 'id');
            if (!id) return client.get('/v1/workflows');
            const enc = encodeURIComponent(id);
            const [def, bp, runs] = await Promise.all([
                client.get(`/v1/workflows/${enc}`),
                client.get(`/v1/workflows/${enc}/blueprint`),
                client.get(`/v1/workflows/${enc}/runs`),
            ]);
            const recentRuns = (((runs.data as { runs?: unknown[] } | undefined)?.runs) ?? []).slice(0, 5);
            return { ok: def.ok, data: { definition: def.data ?? def, blueprint: bp.ok === false ? null : (bp.data ?? null), recentRuns } } as ApiResponse;
        },
    },
    {
        name: 'aimeat_workflow_run',
        description: 'Run a workflow. mode="signals-only" evaluates signals against memory (no dispatch — instant health check); mode="full" executes the steps.',
        input: {
            id: { type: 'string', required: true, description: 'The workflow id.' },
            mode: { type: 'string', required: true, description: 'signals-only | full' },
        },
        handler: ({ client }, input) => client.post(`/v1/workflows/${encodeURIComponent(requiredString(input, 'id'))}/run`, { mode: requiredString(input, 'mode') }),
    },
];
