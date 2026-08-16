/**
 * @file cli/connect/tool-call-defs-apps.ts
 * @description App-fork, IAM, organism-archive, workspace-transfer, wallet, app, extension, cortex and workflow connect-call tool definitions. Extracted from cli/connect/tool-call.ts to satisfy max-file-lines.
 * @structure
 *   - attachProofOverHttp() -- the acceleration-proof attach, over the doors a connector has. Shared
 *     with the connector's MCP registration (mcp/tools/appdev.ts) so the two cannot drift.
 *   - appTools[] -- the shell handler table registered by tool-call.ts
 * @usage
 *   import { appTools } from './tool-call-defs-apps.js';
 * @version-history
 *   v1.2.0 -- 2026-08-11 -- proof_attach APPENDS to the ledger instead of replacing it, writes the
 *     ContributionProof shape routes/library-packs.ts actually reads, and lands in the owner
 *     namespace where services/contribution-proofs.ts keeps both records. The append logic is
 *     attachProofOverHttp(), shared with the connector's MCP door.
 *   v1.1.0 -- 2026-07-19 -- Connector reachability: shell handlers for app drafts, appdev overview/
 *     pitfalls/templates/proofs, commerce (psp/app-tools/offer/checkout) and workflow answer/pending —
 *     thin REST proxies (dedicated routes where they exist; the generic /v1/memory + agents/offers
 *     routes for the seller memory-record tools). See tool→route table in each handler.
 *   v1.0.0 -- 2026-07-13 -- Extracted from tool-call.ts (max-file-lines)
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalNumber, optionalBoolean, requiredArray, optionalArray, requiredRecord, optionalRecord } from './tool-call-helpers.js';
import type { AimeatClient, ApiResponse } from './api-client.js';
import { defineAppIam } from '../../services/iam/define-app-iam.js';
import type { LevelDef } from '../../services/iam/model.js';
import type { CommandDef } from '../../services/iam/app-commands.js';
import type { ContributionProof } from '../../models/contribution-proof.js';

/** What a caller states about one run, in the connector's own wire vocabulary. */
export interface ProofAttachInput {
    subjectType: 'library_pack' | 'app_template';
    subjectId: string;
    model: string;
    verdict: 'pass' | 'fail';
    evidence: string;
    testSet?: string;
    tokens?: number;
}

/** The ledger's address, by subject: a community pack's proofs record, or the proposal manifest. */
const proofLedgerKey = (input: ProofAttachInput): string => input.subjectType === 'library_pack'
    ? `libpack.proofs.${input.subjectId}`
    : `template.catalog.${input.subjectId}.manifest`;

const refuse = (code: string, message: string): ApiResponse => ({ ok: false, error: { code, message } });

const DUPLICATE_PROOF_MESSAGE =
    'Duplicate proof (same model + test set + date). The ledger is append-only, one entry per run.';

/**
 * Attach one self-reported acceleration proof, over the doors a connector has.
 *
 * The capability itself is services/contribution-proofs.ts, and there is no REST route for it, so
 * this reaches the same two records through GET/POST /v1/memory. Three things it fixes, all of which
 * failed silently:
 *
 * 1. It SET the record. A second proof for the same pack deleted the first, and the call returned 200.
 * 2. It wrote `{model, summary, created}`. routes/library-packs.ts counts `verdict === 'pass'` over
 *    ContributionProof records, so a connector-written proof could never reach `proven_models`, which
 *    is the one place a proof is meant to show up.
 * 3. It wrote under the calling agent's own GAII. Both records belong to the OWNER GHII
 *    (services/contribution-proofs.ts, services/app-template-proposals.ts), and a second ledger for
 *    the same pack hides the first: the reader keys proofs by packId, last record read wins.
 *
 * The append costs a read, so this path needs `memory:read` as well as the tool's `memory:write`.
 */
export async function attachProofOverHttp(client: AimeatClient, input: ProofAttachInput): Promise<ApiResponse> {
    const key = proofLedgerKey(input);
    // owner_scope on the read as well: the ledger sits under the owner GHII, and `soft=1` turns a
    // first-ever proof into an empty read rather than a 404 the caller would report as a failure.
    const read = await client.get(`/v1/memory/${encodeURIComponent(key)}?owner_scope=true&soft=1`);
    if (read.ok === false) return read;
    const record = (read.data ?? {}) as { exists?: boolean; value?: unknown; visibility?: string; tags?: string[] };
    const stored = record.exists === true ? record.value : null;

    const now = new Date().toISOString();
    const proof: ContributionProof = {
        model: input.model.trim().toLowerCase(),
        verdict: input.verdict,
        evidence: input.evidence,
        ...(input.testSet ? { testSet: input.testSet } : {}),
        ...(typeof input.tokens === 'number' ? { tokens: input.tokens } : {}),
        date: now.slice(0, 10),
        selfReported: true,
    };
    // The ledger contract the node states and the tool description promises: append-only, one entry
    // per run, a repeat of (model, test set, date) refused. Source of truth is
    // services/contribution-proofs.ts; this door emulates it because it cannot call it.
    const duplicateOf = (list: ContributionProof[]): boolean => list.some(p =>
        p.model === proof.model && (p.testSet ?? '') === (proof.testSet ?? '') && p.date === proof.date);
    const answer = (total: number): ApiResponse => ({
        ok: true,
        data: {
            attached: true, subject_type: input.subjectType, subject_id: input.subjectId,
            proofs_total: total, self_reported: true,
        },
    });

    if (input.subjectType === 'library_pack') {
        const ledger = (stored ?? {}) as { proofs?: unknown };
        const proofs = (Array.isArray(ledger.proofs) ? [...ledger.proofs] : []) as ContributionProof[];
        if (duplicateOf(proofs)) return refuse('DUPLICATE_PROOF', DUPLICATE_PROOF_MESSAGE);
        proofs.push(proof);
        const written = await client.post('/v1/memory', {
            key,
            value: { packId: input.subjectId, proofs },
            visibility: 'public',
            tags: ['libpack-proofs'],
            owner_scope: true,
        });
        return written.ok === false ? written : answer(proofs.length);
    }

    // app_template: the proof rides in the caller's own proposal manifest, which must already exist.
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        return refuse('NOT_FOUND', `Template proposal not found: ${input.subjectId}`);
    }
    const manifest = { ...(stored as JsonObject) };
    const proofs = (Array.isArray(manifest.proofs) ? [...manifest.proofs] : []) as ContributionProof[];
    if (duplicateOf(proofs)) return refuse('DUPLICATE_PROOF', DUPLICATE_PROOF_MESSAGE);
    proofs.push(proof);
    manifest.proofs = proofs;
    manifest.updatedAt = now;
    const written = await client.post('/v1/memory', {
        key,
        value: manifest,
        // The proposal's visibility and tags are the proposal's business. This write appends a proof,
        // it leaves who may read the proposal where the proposal put it.
        visibility: record.visibility ?? 'private',
        tags: record.tags ?? [],
        owner_scope: true,
    });
    return written.ok === false ? written : answer(proofs.length);
}

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
            extension_name: { type: 'string', description: 'Extension name. (`name` is accepted as the older spelling this door used.)' },
            name: { type: 'string', description: 'Older spelling of extension_name.' },
            action_id: { type: 'string', required: true, description: 'Action identifier.' },
            input: { type: 'object', description: 'Input parameters.' },
            instance_id: { type: 'string', description: 'Which installed instance to invoke, when the extension has more than one.' },
        },
        handler: ({ client }, input) => client.post(
            `/v1/ext/${encodeURIComponent(optionalString(input, 'extension_name') ?? requiredString(input, 'name'))}/${encodeURIComponent(requiredString(input, 'action_id'))}${query({ instance_id: optionalString(input, 'instance_id') })}`,
            optionalRecord(input, 'input') ?? {},
        ),
    },
    {
        name: 'aimeat_extension_install',
        description: 'Install an extension from a manifest.',
        input: {
            name: { type: 'string', required: true, description: 'Extension name.' },
            manifest: { type: 'object', required: true, description: 'Extension manifest object.' },
            scripts: { type: 'object', description: 'The extension SOURCE, as { path: contents }. POST /v1/extensions reads it; without it the install has a manifest and no code.' },
            update: { type: 'boolean', description: 'Update an extension that already exists instead of refusing.' },
            activate: { type: 'boolean', description: 'Activate it once installed.' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = { name: requiredString(input, 'name'), manifest: requiredRecord(input, 'manifest') };
            const scripts = optionalRecord(input, 'scripts');
            if (scripts) body.scripts = scripts;
            if (optionalBoolean(input, 'update')) body.update = true;
            if (optionalBoolean(input, 'activate')) body.activate = true;
            return client.post('/v1/extensions', body);
        },
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
            libs: { type: 'object', description: 'The cortex library sources, as { path: contents }. POST /v1/cortex reads it; without it the pack installs with no code in it.' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = { name: requiredString(input, 'name'), manifest: requiredRecord(input, 'manifest') };
            const libs = optionalRecord(input, 'libs');
            if (libs) body.libs = libs;
            return client.post('/v1/cortex', body);
        },
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
    {
        // → POST /v1/workflows/:id/runs/:runId/steps/:stepId/answer — answer a paused human-input step.
        name: 'aimeat_workflow_answer',
        description: 'Answer a paused human-input step of a workflow run (resumes the run).',
        input: {
            workflow_id: { type: 'string', description: 'The workflow id. (`id` is accepted as the older spelling this door used.)' },
            id: { type: 'string', description: 'Older spelling of workflow_id.' },
            run_id: { type: 'string', required: true, description: 'The run id (from aimeat_workflow_pending_inputs).' },
            step_id: { type: 'string', required: true, description: 'The paused step id awaiting input.' },
            picks: { type: 'array', description: 'Option ids from the pinned question (may be empty when answering with `other` alone).' },
            other: { type: 'string', description: 'Free-text answer; only when the question allows it.' },
        },
        // NOT A DROPPED PARAMETER — A BROKEN TOOL. The route reads { picks, other } and this door
        // sent { answer: {...} }, so every human-input answer from /local/call was accepted as an
        // empty body and the run stayed parked. `answer` is still read, as an object carrying picks
        // and other, so a caller written against the old shape keeps working.
        handler: ({ client }, input) => {
            const workflowId = optionalString(input, 'workflow_id') ?? requiredString(input, 'id');
            const legacy = optionalRecord(input, 'answer') ?? {};
            const picks = optionalArray(input, 'picks') ?? (Array.isArray(legacy.picks) ? legacy.picks : []);
            const other = optionalString(input, 'other') ?? (typeof legacy.other === 'string' ? legacy.other : undefined);
            const body: JsonObject = { picks };
            if (other !== undefined) body.other = other;
            return client.post(
                `/v1/workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(requiredString(input, 'run_id'))}/steps/${encodeURIComponent(requiredString(input, 'step_id'))}/answer`,
                body,
            );
        },
    },
    {
        // → GET /v1/workflows/pending-inputs — every run of the caller's workflows awaiting human input.
        name: 'aimeat_workflow_pending_inputs',
        description: 'List workflow runs paused awaiting human input (answer them with aimeat_workflow_answer).',
        input: {},
        handler: ({ client }) => client.get('/v1/workflows/pending-inputs'),
    },
    // ── App drafts (staging): edit + test the next version without touching the live app ──
    {
        // → PUT /v1/apps/:owner/:filename/draft (owner resolved server-side from the session).
        name: 'aimeat_app_draft_save',
        description: 'Save the app\'s NEXT version as a draft (staging) without touching the live app. content is base64-encoded HTML.',
        input: {
            filename: { type: 'string', required: true, description: 'App filename, e.g. "shop.html".' },
            content: { type: 'string', required: true, description: 'Base64-encoded HTML of the draft.' },
            name: { type: 'string', description: 'Display name (defaults to the live app\'s).' },
            description: { type: 'string', description: 'Description (defaults to the live app\'s).' },
            category: { type: 'string', description: 'Category (defaults to the live app\'s).' },
            tags: { type: 'array', description: 'Tags (default: the live app\'s).' },
            icon: { type: 'string', description: 'Emoji icon (defaults to the live app\'s).' },
        },
        handler: ({ client, config }, input) => {
            const filename = requiredString(input, 'filename');
            const body: JsonObject = { content: requiredString(input, 'content') };
            const name = optionalString(input, 'name'); if (name) body.name = name;
            const description = optionalString(input, 'description'); if (description !== undefined) body.description = description;
            const category = optionalString(input, 'category'); if (category) body.category = category;
            const icon = optionalString(input, 'icon'); if (icon) body.icon = icon;
            const tags = optionalArray(input, 'tags'); if (tags) body.tags = tags;
            return client.put(`/v1/apps/${encodeURIComponent(config.owner)}/${encodeURIComponent(filename)}/draft`, body);
        },
    },
    {
        // → POST /v1/apps/:owner/:filename/publish-draft — promote the saved draft to a new live version.
        name: 'aimeat_app_draft_publish',
        description: 'Promote the saved draft to a new live version and clear the draft slot.',
        input: { filename: { type: 'string', required: true, description: 'App filename whose draft to publish.' } },
        handler: ({ client, config }, input) => client.post(`/v1/apps/${encodeURIComponent(config.owner)}/${encodeURIComponent(requiredString(input, 'filename'))}/publish-draft`),
    },
    {
        // → DELETE /v1/apps/:owner/:filename/draft — discard the draft (live app untouched).
        name: 'aimeat_app_draft_discard',
        description: 'Discard the saved draft; the live app is untouched.',
        input: { filename: { type: 'string', required: true, description: 'App filename whose draft to discard.' } },
        handler: ({ client, config }, input) => client.delete(`/v1/apps/${encodeURIComponent(config.owner)}/${encodeURIComponent(requiredString(input, 'filename'))}/draft`),
    },
    // ── AppDev research KB: overview, learned pitfalls, template proposals, acceleration proofs ──
    {
        // → GET /v1/appdev/overview[?model=&sections=] — the "big picture" build research surface.
        name: 'aimeat_appdev_overview',
        description: 'One-call AppDev research surface: your apps, library packs (with proofs), templates, learned pitfalls.',
        input: {
            model: { type: 'string', description: 'Indicative model filter for proofs + learned pitfalls.' },
            sections: { type: 'string', description: 'Comma-separated section filter (apps,library_packs,templates,pitfalls,...).' },
        },
        handler: ({ client }, input) => client.get(`/v1/appdev/overview${query({ model: optionalString(input, 'model'), sections: optionalString(input, 'sections') })}`),
    },
    {
        // → GET /v1/appdev/pitfalls/learned[?include_shared=1] — the caller's learned pitfall entries.
        name: 'aimeat_appdev_pitfall_list',
        description: 'List learned appdev-pitfall entries in your owner scope (optionally including others\' shared entries).',
        input: {
            include_shared: { type: 'boolean', description: 'Also include other owners\' public-shared entries.' },
            scope: { type: 'string', description: 'Filter by scope.' },
            category: { type: 'string', description: 'Filter by category.' },
            model: { type: 'string', description: 'Filter by the model that reported it.' },
            applies_to: { type: 'string', description: 'Filter by what the entry applies to.' },
            status: { type: 'string', description: 'Filter by entry status.' },
            limit: { type: 'number', description: 'Max entries to return.' },
            offset: { type: 'number', description: 'Offset into the result set.' },
        },
        // Every filter the catalog published arrived here and stopped: the listing was always the
        // whole thing, and a caller asking for one category got everything and had to filter twice.
        handler: ({ client }, input) => client.get(`/v1/appdev/pitfalls/learned${query({
            include_shared: optionalBoolean(input, 'include_shared') ? '1' : undefined,
            scope: optionalString(input, 'scope'),
            category: optionalString(input, 'category'),
            model: optionalString(input, 'model'),
            applies_to: optionalString(input, 'applies_to'),
            status: optionalString(input, 'status'),
            limit: optionalNumber(input, 'limit'),
            offset: optionalNumber(input, 'offset'),
        })}`),
    },
    {
        // → DELETE /v1/appdev/pitfalls/learned/:category/:slug — remove one learned entry.
        name: 'aimeat_appdev_pitfall_delete',
        description: 'Delete one of your learned appdev-pitfall entries by category + slug.',
        input: {
            category: { type: 'string', required: true, description: 'Kebab-case category.' },
            slug: { type: 'string', required: true, description: 'Kebab-case slug.' },
        },
        handler: ({ client }, input) => client.delete(`/v1/appdev/pitfalls/learned/${encodeURIComponent(requiredString(input, 'category'))}/${encodeURIComponent(requiredString(input, 'slug'))}`),
    },
    {
        // Report/upsert a learned pitfall. No dedicated REST route (the server MCP writes the knowledge
        // record + manifest directly), so the shell proxy writes the same owner memory record via the
        // generic POST /v1/memory (memory:write authz unchanged); the manifest side-index is a server-MCP
        // nicety the shell path skips.
        name: 'aimeat_appdev_pitfall_report',
        description: 'Report/upsert a learned appdev pitfall (model-attributed). Writes the owner knowledge record; share=true publishes it platform-wide.',
        input: {
            model: { type: 'string', required: true, description: 'YOUR OWN model id (self-identify; indicative).' },
            category: { type: 'string', required: true, description: 'Kebab-case category (auth, ext, cortex, ...).' },
            title: { type: 'string', required: true, description: 'Short imperative title.' },
            symptom: { type: 'string', required: true, description: 'What the builder observes.' },
            resolution: { type: 'string', required: true, description: 'What to do instead.' },
            slug: { type: 'string', description: 'Stable kebab-case slug (derived from title when omitted).' },
            applies_to: { type: 'array', description: 'Areas this applies to.' },
            severity: { type: 'string', enum: ['info', 'warn', 'critical'], description: 'Default warn.' },
            status: { type: 'string', enum: ['active', 'outdated'], description: 'Default active.' },
            app_ref: { type: 'string', description: 'Related app owner/filename.html.' },
            share: { type: 'boolean', description: 'true = publish platform-wide (public).' },
        },
        handler: ({ client }, input) => {
            const kebab = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            const model = requiredString(input, 'model').trim().toLowerCase();
            const category = kebab(requiredString(input, 'category'));
            const title = requiredString(input, 'title');
            const slug = (optionalString(input, 'slug') ?? title).toLowerCase();
            const finalSlug = kebab(slug);
            const appliesTo = (optionalArray(input, 'applies_to') ?? []).map(a => String(a).toLowerCase());
            const now = new Date().toISOString();
            const share = optionalBoolean(input, 'share');
            const value: JsonObject = {
                title, symptom: requiredString(input, 'symptom'), resolution: requiredString(input, 'resolution'),
                model, category, slug: finalSlug, applies_to: appliesTo,
                severity: optionalString(input, 'severity') ?? 'warn', status: optionalString(input, 'status') ?? 'active',
                updated: now,
            };
            const appRef = optionalString(input, 'app_ref'); if (appRef) value.app_ref = appRef;
            return client.post('/v1/memory', {
                key: `packages/appdev-pitfalls/${category}/${finalSlug}`,
                value,
                visibility: share === true ? 'public' : 'owner',
                tags: ['knowledge-entry', 'pitfall', `model:${model}`, ...appliesTo.map(a => `applies:${a}`)],
            });
        },
    },
    {
        // Attach a self-reported acceleration proof to a community library pack or one of your own
        // template proposals. No dedicated REST route exists, so the append runs over GET/POST
        // /v1/memory in attachProofOverHttp() above, which the connector's MCP door calls as well.
        name: 'aimeat_appdev_proof_attach',
        description: 'Attach a self-reported acceleration proof (model, pass/fail, evidence) to a community library pack you own or one of your app-template proposals. Append-only: a repeat of the same model + test set + date is refused.',
        input: {
            subject_type: { type: 'string', required: true, enum: ['library_pack', 'app_template'], description: 'What the proof attaches to.' },
            subject_id: { type: 'string', required: true, description: 'Community pack id (cortex name) or template proposal id.' },
            model: { type: 'string', required: true, description: 'YOUR OWN model id (self-identify; indicative).' },
            verdict: { type: 'string', required: true, enum: ['pass', 'fail'], description: 'Did it accelerate the run. Honest fails make your passes credible.' },
            evidence: { type: 'string', required: true, description: 'URL or node storage/memory ref pointing at the run evidence.' },
            test_set: { type: 'string', description: 'Repeatable test-set id, when one was used.' },
            tokens: { type: 'number', description: 'Output tokens the run consumed, when known.' },
        },
        handler: ({ client }, input) => {
            const subjectType = requiredString(input, 'subject_type');
            const verdict = requiredString(input, 'verdict');
            if (subjectType !== 'library_pack' && subjectType !== 'app_template') {
                return Promise.resolve(refuse('INVALID_INPUT', 'subject_type must be "library_pack" or "app_template"'));
            }
            if (verdict !== 'pass' && verdict !== 'fail') {
                return Promise.resolve(refuse('INVALID_INPUT', 'verdict must be "pass" or "fail"'));
            }
            return attachProofOverHttp(client, {
                subjectType,
                subjectId: requiredString(input, 'subject_id'),
                model: requiredString(input, 'model'),
                verdict,
                evidence: requiredString(input, 'evidence'),
                testSet: optionalString(input, 'test_set'),
                tokens: optionalNumber(input, 'tokens'),
            });
        },
    },
    {
        // → GET /v1/appdev/templates — the caller's owner-scope template proposals (full manifests).
        name: 'aimeat_app_template_list',
        description: 'List your app-template proposals (full manifests).',
        input: {},
        handler: ({ client }) => client.get('/v1/appdev/templates'),
    },
    {
        // → GET /v1/appdev/templates/:id — one proposal + the source app's live state.
        name: 'aimeat_app_template_get',
        description: 'Get one app-template proposal by id (with the source app\'s live state).',
        input: { id: { type: 'string', required: true, description: 'Template id.' } },
        handler: ({ client }, input) => client.get(`/v1/appdev/templates/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        // → DELETE /v1/appdev/templates/:id — remove a proposal.
        name: 'aimeat_app_template_delete',
        description: 'Delete one of your app-template proposals by id.',
        input: { id: { type: 'string', required: true, description: 'Template id.' } },
        handler: ({ client }, input) => client.delete(`/v1/appdev/templates/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        // Propose/upsert an app-template. No dedicated REST route (the server MCP validates + builds the
        // manifest, then writes template.catalog.{id}.manifest), so the shell proxy writes that same owner
        // memory record via POST /v1/memory (memory:write authz unchanged).
        name: 'aimeat_app_template_propose',
        description: 'Propose/upsert an app template distilled from an app you published (call after a successful publish).',
        input: {
            id: { type: 'string', required: true, description: 'Stable kebab-case template id (re-proposing updates it).' },
            title: { type: 'string', required: true, description: 'Template title.' },
            description: { type: 'string', required: true, description: 'What this template is for.' },
            owner: { type: 'string', required: true, description: 'Your own owner name (source app owner).' },
            filename: { type: 'string', required: true, description: 'The published app this template distills.' },
            tier: { type: 'string', enum: ['T1', 'T2', 'T3'], description: 'T1 pure client · T2 +cortex · T3 +extension.' },
            reuse_notes: { type: 'string', required: true, description: 'What generalizes — the parts a next build should keep.' },
            model: { type: 'string', required: true, description: 'YOUR OWN model id (self-identify; indicative).' },
            tags: { type: 'array', description: 'Optional tags.' },
            start_mode: { type: 'string', enum: ['fork', 'scaffold', 'either'], description: 'How the next build should start (default either).' },
            start_mode_rationale: { type: 'string', description: 'Why that start mode, for whoever picks the template up.' },
            model_notes: { type: 'string', description: 'What the reporting model found hard or easy here.' },
            packs: { type: 'array', description: 'Library packs the template needs.' },
            composes: { type: 'array', description: 'Other templates this one composes with.' },
            derived_from: { type: 'object', description: 'Explicit { owner, filename } source, when it is not the owner/filename pair above.' },
        },
        handler: ({ client }, input) => {
            const id = requiredString(input, 'id');
            const value: JsonObject = {
                id, title: requiredString(input, 'title'), description: requiredString(input, 'description'),
                derivedFrom: optionalRecord(input, 'derived_from')
                    ?? { owner: requiredString(input, 'owner'), filename: requiredString(input, 'filename') },
                tier: optionalString(input, 'tier') ?? 'T1',
                reuseNotes: requiredString(input, 'reuse_notes'),
                model: requiredString(input, 'model').trim().toLowerCase(),
                tags: optionalArray(input, 'tags') ?? [],
                startMode: optionalString(input, 'start_mode') ?? 'either',
                updatedAt: new Date().toISOString(),
            };
            // The five fields a template is actually chosen by. Dropped, every proposal looked
            // identical to the next one in the catalogue.
            const rationale = optionalString(input, 'start_mode_rationale');
            const modelNotes = optionalString(input, 'model_notes');
            const packs = optionalArray(input, 'packs');
            const composes = optionalArray(input, 'composes');
            if (rationale) value.startModeRationale = rationale;
            if (modelNotes) value.modelNotes = modelNotes;
            if (packs) value.packs = packs;
            if (composes) value.composes = composes;
            return client.post('/v1/memory', { key: `template.catalog.${id}.manifest`, value, visibility: 'owner', tags: ['app-template'] });
        },
    },
    // ── Commerce: seller PSP credentials, sellable app-tool manifests, offer pricing, buyer checkout ──
    {
        // Store the owner's PSP secret. No dedicated REST route (server MCP writes commerce.psp), so the
        // shell proxy writes that private owner record via POST /v1/memory (memory:write authz unchanged).
        name: 'aimeat_commerce_psp_set',
        description: 'Store your owner\'s payment-provider credentials (commerce.psp) for selling in money currencies. The secret is stored server-side.',
        input: {
            provider: { type: 'string', required: true, description: 'PSP identifier, e.g. "stripe".' },
            secret_key: { type: 'string', required: true, description: 'The PSP secret credential.' },
        },
        handler: ({ client }, input) => client.post('/v1/memory', {
            key: 'commerce.psp',
            value: { provider: requiredString(input, 'provider'), secretKey: requiredString(input, 'secret_key') },
            visibility: 'private',
            tags: ['commerce'],
        }),
    },
    {
        // → GET /v1/memory/commerce.psp — the owner reads their own PSP record (shell runs as the owner).
        name: 'aimeat_commerce_psp_status',
        description: 'Read your owner\'s stored PSP record (commerce.psp).',
        input: {},
        handler: ({ client }) => client.get('/v1/memory/commerce.psp'),
    },
    {
        // → DELETE /v1/memory/commerce.psp — delete the owner's PSP record.
        name: 'aimeat_commerce_psp_delete',
        description: 'Delete your owner\'s stored PSP credentials (commerce.psp).',
        input: {},
        handler: ({ client }) => client.delete('/v1/memory/commerce.psp'),
    },
    {
        // Publish the sellable tool manifest of an app. No dedicated REST route (server MCP validates +
        // writes apps.{app_id}.tools), so the shell proxy writes that public owner record via POST /v1/memory.
        name: 'aimeat_app_tools_publish',
        description: 'Publish/replace the sellable TOOL MANIFEST of one of your apps (apps.{app_id}.tools). Replaces the whole manifest.',
        input: {
            app_id: { type: 'string', required: true, description: 'The app\'s published filename (manifest key is apps.{app_id}.tools).' },
            tools: { type: 'array', required: true, description: 'Full tool list: [{ name, description?, inputSchema?, action_id?, agent?, price?, priceMoney? }].' },
            odps: { type: 'object', description: 'ODPS product block published alongside the manifest.' },
            provenance: { type: 'object', description: 'How the manifest was produced.' },
        },
        handler: ({ client }, input) => {
            const value: JsonObject = { version: 1, updatedAt: new Date().toISOString(), tools: requiredArray(input, 'tools') };
            const odps = optionalRecord(input, 'odps');
            const provenance = optionalRecord(input, 'provenance');
            if (odps) value.odps = odps;
            if (provenance) value.provenance = provenance;
            return client.post('/v1/memory', {
                key: `apps.${requiredString(input, 'app_id')}.tools`,
                value,
                visibility: 'public',
                tags: ['commerce', 'app-tools'],
            });
        },
    },
    {
        // → GET /v1/memory/apps.{app_id}.tools — read the manifest (own always; others only when public).
        name: 'aimeat_app_tools_get',
        description: 'Read an app\'s sellable tool manifest (apps.{app_id}.tools). Omit owner for your own; pass a full GHII (owner@node) to read another owner\'s PUBLIC manifest.',
        input: {
            app_id: { type: 'string', required: true, description: 'The app\'s published filename.' },
            owner: { type: 'string', description: 'App owner GHII (owner@node) for a cross-owner public read. Default: your own owner.' },
        },
        handler: ({ client }, input) => {
            const key = `apps.${requiredString(input, 'app_id')}.tools`;
            const owner = optionalString(input, 'owner');
            // A bare owner used to fall back to reading YOUR OWN manifest, which is the worst kind
            // of wrong answer: the caller asked about someone else's app and got their own back with
            // no indication that the question had changed. Say so instead.
            if (owner && !owner.includes('@')) {
                return Promise.resolve({ ok: false as const, error: {
                    code: 'INVALID_INPUT',
                    message: `owner must be a full GHII ("${owner}@<node-id>"), not a bare name — a cross-owner read needs the node it lives on. Omit owner entirely to read your own manifest.`,
                } });
            }
            return owner
                ? client.get(`/v1/memory/${encodeURIComponent(owner)}/${encodeURIComponent(key)}`)
                : client.get(`/v1/memory/${encodeURIComponent(key)}`);
        },
    },
    {
        // Set/clear one offer's price. No single-field route; the shell proxy reads the whole offers doc
        // (GET /v1/agents/:name/offers), patches the one offer, and writes it back (PUT — the same
        // whole-doc contract the server MCP uses), so agent-role authz is unchanged.
        name: 'aimeat_offer_price_set',
        description: 'Set or clear the price (morsels and/or money micro-units) and visibility of one offer on your agent.',
        input: {
            agent_name: { type: 'string', required: true, description: 'Bare name of your agent that publishes the offer.' },
            offer_id: { type: 'string', required: true, description: 'The offer id inside agents.{agent_name}.offers.' },
            price_morsels: { type: 'number', description: 'Morsel price per call (integer, >0).' },
            money_amount_micros: { type: 'number', description: 'Money price in integer 6-decimal micro-units.' },
            money_currency: { type: 'string', enum: ['EUR', 'USD'], description: 'Currency for money_amount_micros.' },
            clear_morsels: { type: 'boolean', description: 'Remove the morsel price.' },
            clear_money: { type: 'boolean', description: 'Remove the money price.' },
            visibility: { type: 'string', enum: ['private', 'unlisted', 'public'], description: 'Offer visibility.' },
        },
        handler: async ({ client }, input) => {
            const agentName = requiredString(input, 'agent_name');
            const offerId = requiredString(input, 'offer_id');
            const current = await client.get(`/v1/agents/${encodeURIComponent(agentName)}/offers`);
            if (current.ok === false) return current;
            const data = current.data as { offers?: Array<Record<string, unknown>> } | undefined;
            const offers = Array.isArray(data?.offers) ? data!.offers : [];
            const offer = offers.find(o => o.id === offerId);
            if (!offer) return { ok: false as const, error: { code: 'OFFER_NOT_FOUND', message: `No offer "${offerId}" on agent "${agentName}"` } };
            const priceMorsels = optionalNumber(input, 'price_morsels');
            if (priceMorsels !== undefined) offer.price = { morsels: priceMorsels, unit: (offer.price as { unit?: string } | undefined)?.unit ?? 'per-call' };
            if (optionalBoolean(input, 'clear_morsels')) offer.price = null;
            const moneyMicros = optionalNumber(input, 'money_amount_micros');
            if (moneyMicros !== undefined) offer.priceMoney = { amount: moneyMicros, currency: optionalString(input, 'money_currency') ?? 'EUR' };
            if (optionalBoolean(input, 'clear_money')) offer.priceMoney = null;
            const visibility = optionalString(input, 'visibility'); if (visibility) offer.visibility = visibility;
            return client.put(`/v1/agents/${encodeURIComponent(agentName)}/offers`, { offers });
        },
    },
    {
        // → POST /v1/commerce/checkout-sessions — open a buyer checkout session.
        name: 'aimeat_checkout_open',
        description: 'Open a checkout session as a buyer (your owner\'s balance pays). Items reference agent offers or app-tools.',
        input: {
            items: { type: 'array', required: true, description: '[{ kind?, agent?, offer_id?, app?, tool?, input?, quantity? }].' },
            note: { type: 'string', description: 'Buyer note delivered with the order.' },
            currency: { type: 'string', description: '"morsel" (default) or a money code (EUR/USD).' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = { items: requiredArray(input, 'items') };
            const note = optionalString(input, 'note'); if (note) body.note = note;
            const currency = optionalString(input, 'currency'); if (currency) body.currency = currency;
            return client.post('/v1/commerce/checkout-sessions', body);
        },
    },
    {
        // → POST /v1/commerce/checkout-sessions/:id/complete — pay + fulfill an open session.
        name: 'aimeat_checkout_complete',
        description: 'Pay + fulfill an open checkout session (charges your owner\'s balance or a money handler).',
        input: {
            session_id: { type: 'string', required: true, description: 'The open session id from aimeat_checkout_open.' },
            handler: { type: 'string', description: 'Payment handler id (default io.aimeat.morsels).' },
        },
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const handler = optionalString(input, 'handler'); if (handler) body.handler = handler;
            return client.post(`/v1/commerce/checkout-sessions/${encodeURIComponent(requiredString(input, 'session_id'))}/complete`, body);
        },
    },
    {
        // → GET /v1/commerce/checkout-sessions — list the owner's checkout sessions, newest first.
        name: 'aimeat_checkout_list',
        description: 'List your owner\'s checkout sessions (purchases), newest first.',
        input: { limit: { type: 'number', description: 'Max sessions to return (default 20, max 200).' } },
        handler: ({ client }, input) => client.get(`/v1/commerce/checkout-sessions${query({ limit: optionalNumber(input, 'limit') })}`),
    },
];
