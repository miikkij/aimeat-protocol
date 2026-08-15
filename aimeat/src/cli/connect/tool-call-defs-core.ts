/**
 * @file cli/connect/tool-call-defs-core.ts
 * @description Memory, discovery, work, wallet, board, storage, admin, capabilities, catalogue, consent, flag, group, instance, knowledge and skill connect-call tool definitions. Extracted from cli/connect/tool-call.ts to satisfy max-file-lines.
 * @structure
 *   - knowledgeContributeUnreachable() -- the one refusal both connector doors serve for the knowledge
 *     entry write, which this node exposes over MCP only
 *   - coreTools[] -- the shell handler table registered by tool-call.ts
 * @usage
 *   import { coreTools } from './tool-call-defs-core.js';
 * @version-history
 *   v1.3.0 -- 2026-08-15 -- aimeat_storage_delete: DELETE /v1/storage/<key>, own namespace only.
 *   v1.2.0 -- 2026-08-11 -- aimeat_knowledge_contribute stops posting {entry_key, content} to
 *     POST /v1/knowledge/:id/contribute. That route shares a package with an organism and answered
 *     400 MISSING_FIELDS for every one of these calls, so the tool has never worked. It now says
 *     where the capability lives instead of failing on a route that was never its own.
 *   v1.1.0 -- 2026-08-01 -- TARGET-058 Phase 11: aimeat_memory_write forwards `ai_provenance_id` into
 *     the write body. The inline `ai_provenance` declaration is handled once, for every tool in this
 *     table, by withProvenanceCarrying() in tool-call.ts.
 *   v1.0.0 -- 2026-07-13 -- Extracted from tool-call.ts (max-file-lines)
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, requiredValue, optionalNumber, optionalBoolean, optionalArray, optionalRecord, requiredArray } from './tool-call-helpers.js';
import type { ApiResponse } from './api-client.js';

/**
 * Appended to the catalog description on both connector doors. An agent that learns this from the
 * tool list spends no call finding it out, and the sentence is short enough that it does not bury
 * what the tool is for.
 */
export const KNOWLEDGE_CONTRIBUTE_CONNECTOR_NOTE =
    ' CONNECTOR LIMIT: this write has no HTTP route, so calling it here refuses and tells you where to '
    + 'run it instead. The knowledge read tools (list, get, links) work normally.';

/**
 * Adding an entry to a knowledge package, from a connector that speaks HTTP and nothing else.
 *
 * The capability is services/knowledge-package-entry.ts, reachable through the node's MCP tool
 * `aimeat_knowledge_contribute` and through no route at all. The name collides with one that does
 * exist: POST /v1/knowledge/:id/contribute shares a WHOLE package with an organism and requires
 * `organism_id`, which is why both connector doors posted `{entry_key, content}` at it and got
 * 400 MISSING_FIELDS every time since the day they were written.
 *
 * Emulating the capability here (write the entry record, then append the manifest's index line over
 * POST /v1/memory) would put the reserved-package guard, the JSON-or-text decision, the tag and
 * visibility inheritance and the index line in a published npm package, second copies of rules that
 * live in the service. That is the drift this whole exercise is undoing. So the tool says what is
 * true, and the door itself is the developer's call.
 */
export function knowledgeContributeUnreachable(): ApiResponse {
    return {
        ok: false,
        error: {
            code: 'NO_HTTP_ROUTE',
            message: 'Adding an entry to a knowledge package is not reachable over HTTP on this node, '
                + 'and the connector only speaks HTTP. POST /v1/knowledge/{id}/contribute is a different '
                + 'capability: it shares a whole package with an organism and requires organism_id. '
                + 'Run aimeat_knowledge_contribute against the node MCP endpoint ({node_url}/v1/mcp) to '
                + 'add the entry, or write the entry record yourself with aimeat_memory_write under '
                + 'packages/{package_id}/{entry_key}, which stores the content but leaves the package '
                + 'manifest without an index line for it.',
        },
    };
}

export const coreTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_memory_read',
        handler: ({ client }, input) => client.get(`/v1/memory/${encodeURIComponent(requiredString(input, 'key'))}`),
    },
    {
        name: 'aimeat_memory_write',
        handler: ({ client }, input) => {
            const body: JsonObject = { key: requiredString(input, 'key'), value: requiredValue(input, 'value') };
            const visibility = optionalString(input, 'visibility');
            const ttlHours = optionalNumber(input, 'ttl_hours');
            if (visibility) body.visibility = visibility;
            const tags = optionalArray(input, 'tags');
            if (tags) body.tags = tags;
            if (ttlHours !== undefined) body.ttl_hours = ttlHours;
            // POST /v1/memory takes a pre-minted record id directly (it checks the record belongs to
            // this owner). An inline `ai_provenance` DECLARATION cannot ride here — the route has no
            // field for it — so withProvenanceCarrying() records that one after the write, against
            // this key. TARGET-058 Phase 11.
            const provenanceId = optionalString(input, 'ai_provenance_id');
            if (provenanceId) body.ai_provenance_id = provenanceId;
            return client.post('/v1/memory', body);
        },
    },
    {
        name: 'aimeat_memory_list',
        handler: ({ client }, input) => {
            const tags = optionalArray(input, 'tags')?.filter((tag): tag is string => typeof tag === 'string');
            return client.get(`/v1/memory${query({
                prefix: optionalString(input, 'prefix'),
                visibility: optionalString(input, 'visibility'),
                tags: tags?.length ? tags.join(',') : undefined,
                owner_scope: optionalBoolean(input, 'owner_scope') ? 'true' : undefined,
                limit: optionalNumber(input, 'limit'),
            })}`);
        },
    },
    {
        name: 'aimeat_memory_search',
        handler: ({ client }, input) => client.get(`/v1/memory/search${query({ q: requiredString(input, 'query') })}`),
    },
    {
        name: 'aimeat_catalogue_search',
        handler: ({ client }, input) => client.get(`/v1/catalogue${query({ q: optionalString(input, 'query') })}`),
    },
    {
        name: 'aimeat_discover',
        handler: ({ client }, input) => {
            const q = query({
                q: optionalString(input, 'q'),
                type: optionalString(input, 'type'),
                tags: optionalString(input, 'tags'),
                segment: optionalString(input, 'segment'),
                scope: optionalString(input, 'scope'),
                per_page: optionalNumber(input, 'limit'),
            });
            // mode=map → facet counts only; mode=find (default) → ranked entries.
            const path = optionalString(input, 'mode') === 'map' ? '/v1/discover/facets' : '/v1/discover';
            return client.get(`${path}${q}`);
        },
    },
    {
        name: 'aimeat_agent_profile',
        handler: ({ client }, input) => client.get(`/v1/agents/${encodeURIComponent(requiredString(input, 'gaii'))}`),
    },
    {
        name: 'aimeat_action_execute',
        handler: ({ client }, input) => {
            const body: JsonObject = { action_id: requiredString(input, 'action_id') };
            const actionInput = optionalRecord(input, 'input');
            if (actionInput) body.input = actionInput;
            return client.post('/v1/work/request', body);
        },
    },
    {
        name: 'aimeat_work_inbox',
        handler: ({ client }) => client.get('/v1/work/inbox'),
    },
    {
        name: 'aimeat_work_accept',
        handler: ({ client }, input) => client.post(`/v1/work/${encodeURIComponent(requiredString(input, 'tracking_code'))}/accept`),
    },
    {
        name: 'aimeat_work_deliver',
        handler: ({ client }, input) => client.post(
            `/v1/work/${encodeURIComponent(requiredString(input, 'tracking_code'))}/deliver`,
            { result: requiredValue(input, 'result') },
        ),
    },
    {
        name: 'aimeat_wallet_balance',
        handler: ({ client }) => client.get('/v1/wallet'),
    },
    {
        name: 'aimeat_board_read',
        handler: ({ client }, input) => client.get(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts`),
    },
    {
        name: 'aimeat_board_post',
        handler: ({ client }, input) => client.post(
            `/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts`,
            { title: requiredString(input, 'title'), body: requiredString(input, 'body') },
        ),
    },
    {
        name: 'aimeat_storage_upload',
        handler: ({ client }, input) => {
            const body: JsonObject = { key: requiredString(input, 'key'), content: requiredString(input, 'content') };
            const mimeType = optionalString(input, 'mime_type');
            if (mimeType) body.mime_type = mimeType;
            return client.post('/v1/storage', body);
        },
    },
    {
        name: 'aimeat_storage_download',
        // `owner` (or an "owner@node/key" reference) reads a file the agent does NOT own — its owner's
        // upload, a DM/task attachment — through /v1/pub, which runs the consent/visibility guard.
        // Without it the read is namespaced to the agent and a perfectly readable file answers 404.
        handler: ({ client }, input) => {
            const key = requiredString(input, 'key');
            const slash = key.indexOf('/');
            const head = slash > 0 ? key.slice(0, slash) : '';
            const owner = optionalString(input, 'owner') ?? (head.includes('@') || head.startsWith('ext:') ? head : '');
            if (!owner) return client.get(`/v1/storage/${encodeURIComponent(key)}`);
            const refKey = optionalString(input, 'owner') ? key : key.slice(slash + 1);
            return client.get(`/v1/pub/${encodeURIComponent(owner)}/${refKey.split('/').map(encodeURIComponent).join('/')}?mode=handle`);
        },
    },
    {
        // Own namespace only, so there is no /v1/pub twin here the way aimeat_storage_download has one.
        name: 'aimeat_storage_delete',
        handler: ({ client }, input) => client.delete(
            `/v1/storage/${requiredString(input, 'key').split('/').map(encodeURIComponent).join('/')}`,
        ),
    },
    {
        name: 'aimeat_admin_stats',
        handler: ({ client }) => client.get('/v1/admin/stats'),
    },
    {
        name: 'aimeat_admin_agents',
        handler: ({ client }) => client.get('/v1/admin/agents'),
    },
    {
        name: 'aimeat_admin_config',
        handler: ({ client }) => client.get('/v1/admin/config'),
    },
    {
        name: 'aimeat_board_list',
        handler: ({ client }) => client.get('/v1/boards'),
    },
    {
        name: 'aimeat_board_create',
        handler: ({ client }, input) => {
            const body: JsonObject = { name: requiredString(input, 'name') };
            const description = optionalString(input, 'description');
            const visibility = optionalString(input, 'visibility');
            if (description) body.description = description;
            if (visibility) body.visibility = visibility;
            return client.post('/v1/boards', body);
        },
    },
    {
        name: 'aimeat_board_subscribe',
        handler: ({ client }, input) => client.post(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/subscribe`),
    },
    {
        name: 'aimeat_board_react',
        handler: ({ client }, input) => client.post(
            `/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts/${encodeURIComponent(requiredString(input, 'post_id'))}/react`,
            { emoji: requiredString(input, 'emoji') },
        ),
    },
    {
        name: 'aimeat_board_reply',
        handler: ({ client }, input) => client.post(
            `/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts/${encodeURIComponent(requiredString(input, 'post_id'))}/replies`,
            { body: requiredString(input, 'body') },
        ),
    },
    {
        name: 'aimeat_board_members',
        handler: ({ client }, input) => client.patch(
            `/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/members`,
            { members: requiredArray(input, 'members') },
        ),
    },
    {
        name: 'aimeat_board_delete',
        handler: ({ client }, input) => client.delete(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}`),
    },
    {
        name: 'aimeat_capabilities_list',
        handler: ({ client }, input) => client.get(`/v1/capabilities${query({ q: optionalString(input, 'query') })}`),
    },
    {
        name: 'aimeat_capabilities_get',
        handler: ({ client }, input) => client.get(`/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_capabilities_invoke',
        handler: ({ client }, input) => client.post(
            `/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}/invoke`,
            optionalRecord(input, 'input') ?? {},
        ),
    },
    {
        name: 'aimeat_capabilities_create',
        handler: ({ client }, input) => client.post('/v1/capabilities', {
            name: requiredString(input, 'name'),
            description: requiredString(input, 'description'),
            type: requiredString(input, 'type'),
        }),
    },
    {
        name: 'aimeat_capabilities_update',
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const name = optionalString(input, 'name');
            const description = optionalString(input, 'description');
            if (name) body.name = name;
            if (description) body.description = description;
            return client.put(`/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}`, body);
        },
    },
    {
        name: 'aimeat_capabilities_delete',
        handler: ({ client }, input) => client.delete(`/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_capabilities_vouch',
        handler: ({ client }, input) => client.post(`/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}/vouch`, {}),
    },
    {
        name: 'aimeat_catalogue_agents',
        handler: ({ client }, input) => client.get(`/v1/catalogue/agents${query({ q: optionalString(input, 'query') })}`),
    },
    {
        name: 'aimeat_catalogue_boards',
        handler: ({ client }) => client.get('/v1/catalogue/boards'),
    },
    {
        name: 'aimeat_catalogue_directory',
        handler: ({ client }, input) => client.get(`/v1/catalogue/directory${query({ q: optionalString(input, 'query') })}`),
    },
    {
        name: 'aimeat_consent_grant',
        handler: ({ client }, input) => {
            const body: JsonObject = { recipient: requiredString(input, 'recipient'), keys: requiredArray(input, 'keys') };
            const purpose = optionalString(input, 'purpose');
            if (purpose) body.purpose = purpose;
            return client.post('/v1/consent', body);
        },
    },
    {
        name: 'aimeat_consent_list',
        handler: ({ client }) => client.get('/v1/consent'),
    },
    {
        name: 'aimeat_consent_revoke',
        handler: ({ client }, input) => client.delete(`/v1/consent/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_flag_report',
        handler: ({ client }, input) => client.post('/v1/flags', {
            target_type: requiredString(input, 'target_type'),
            target_id: requiredString(input, 'target_id'),
            reason: requiredString(input, 'reason'),
        }),
    },
    {
        name: 'aimeat_group_list',
        handler: ({ client }) => client.get('/v1/groups'),
    },
    {
        name: 'aimeat_group_get',
        handler: ({ client }, input) => client.get(`/v1/groups/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_group_create',
        handler: ({ client }, input) => {
            const body: JsonObject = { name: requiredString(input, 'name') };
            const description = optionalString(input, 'description');
            if (description) body.description = description;
            return client.post('/v1/groups', body);
        },
    },
    {
        name: 'aimeat_group_add_member',
        handler: ({ client }, input) => {
            const body: JsonObject = { identifier: requiredString(input, 'identifier') };
            const role = optionalString(input, 'role');
            if (role) body.role = role;
            return client.post(`/v1/groups/${encodeURIComponent(requiredString(input, 'id'))}/members`, body);
        },
    },
    {
        name: 'aimeat_group_remove_member',
        handler: ({ client }, input) => client.delete(`/v1/groups/${encodeURIComponent(requiredString(input, 'id'))}/members/${encodeURIComponent(requiredString(input, 'identifier'))}`),
    },
    {
        name: 'aimeat_share_create',
        handler: ({ client }, input) => {
            const body: JsonObject = { key_pattern: requiredString(input, 'key_pattern') };
            const note = optionalString(input, 'note');
            if (note) body.note = note;
            const expiresAt = optionalString(input, 'expires_at');
            if (expiresAt) body.expires_at = expiresAt;
            return client.post(`/v1/groups/${encodeURIComponent(requiredString(input, 'group_id'))}/shares`, body);
        },
    },
    {
        name: 'aimeat_share_list',
        handler: ({ client }, input) =>
            client.get(optionalString(input, 'direction') === 'incoming' ? '/v1/shares/incoming' : '/v1/shares'),
    },
    {
        name: 'aimeat_share_revoke',
        handler: ({ client }, input) => client.delete(`/v1/shares/${encodeURIComponent(requiredString(input, 'share_id'))}`),
    },
    {
        name: 'aimeat_instance_list',
        handler: ({ client }) => client.get('/v1/instances'),
    },
    {
        name: 'aimeat_instance_create',
        handler: ({ client }, input) => {
            const body: JsonObject = { name: requiredString(input, 'name') };
            const template = optionalString(input, 'template');
            if (template) body.template = template;
            return client.post('/v1/instances', body);
        },
    },
    {
        name: 'aimeat_instance_status',
        handler: ({ client }, input) => client.get(`/v1/instances/${encodeURIComponent(requiredString(input, 'id'))}/status`),
    },
    {
        name: 'aimeat_knowledge_list',
        handler: ({ client }) => client.get('/v1/catalogue/knowledge'),
    },
    {
        name: 'aimeat_knowledge_get',
        handler: ({ client }, input) => client.get(`/v1/knowledge/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        // No HTTP door for the entry write on this node. See knowledgeContributeUnreachable() above:
        // the route of the same name is the organism-sharing capability and rejected this body.
        // (`description` and `input` here are documentation: `connect tools` and `connect schema`
        // both read the shared catalog, which is also where this tool's real input schema lives.)
        name: 'aimeat_knowledge_contribute',
        description: 'Add or update an entry in an existing knowledge package.' + KNOWLEDGE_CONTRIBUTE_CONNECTOR_NOTE,
        handler: () => Promise.resolve(knowledgeContributeUnreachable()),
    },
    {
        name: 'aimeat_knowledge_links',
        handler: ({ client }, input) => client.get(`/v1/knowledge/${encodeURIComponent(requiredString(input, 'id'))}/links`),
    },
    {
        name: 'aimeat_skill_publish',
        handler: ({ client }, input) => client.post('/v1/skills', {
            skill_md: requiredString(input, 'skill_md'),
            files: input.files,
            scope: optionalString(input, 'scope'),
            visibility: optionalString(input, 'visibility'),
            organism: optionalString(input, 'organism_id'),
            ws: optionalString(input, 'workspace_id'),
        }),
    },
    {
        name: 'aimeat_skill_list',
        handler: ({ client, agentPath }, input) => {
            const view = optionalString(input, 'view') ?? 'library';
            if (view === 'linked') return client.get(`/v1/agents/${agentPath}/skills/links`);
            return client.get(`/v1/skills?scope=${view === 'mine' ? 'user' : 'library'}`);
        },
    },
    {
        name: 'aimeat_skill_get',
        handler: ({ client }, input) => {
            const ref = optionalString(input, 'ref');
            const manifestOnly = optionalBoolean(input, 'manifest_only') ? '&manifest_only=true' : '';
            if (ref) {
                const node = ref.match(/^node:([a-z0-9-]+)$/);
                if (node) return client.get(`/v1/skills/${encodeURIComponent(node[1])}?scope=node${manifestOnly}`);
                const user = ref.match(/^user:([a-z0-9_-]+)\/([a-z0-9-]+)$/);
                if (user) return client.get(`/v1/skills/${encodeURIComponent(user[2])}?scope=user&owner=${encodeURIComponent(user[1])}${manifestOnly}`);
                const ws = ref.match(/^ws:([A-Za-z0-9-]+)\/([A-Za-z0-9-]+)\/([a-z0-9-]+)$/);
                if (ws) return client.get(`/v1/skills/${encodeURIComponent(ws[3])}?scope=workspace&organism=${encodeURIComponent(ws[1])}&ws=${encodeURIComponent(ws[2])}${manifestOnly}`);
                throw new Error(`Not a valid skill ref: ${ref}`);
            }
            return client.get(`/v1/skills/${encodeURIComponent(requiredString(input, 'name'))}?${manifestOnly.replace('&', '')}`);
        },
    },
    {
        name: 'aimeat_skill_link',
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/skills`, {
            ref: requiredString(input, 'ref'),
        }),
    },
    {
        name: 'aimeat_skill_unlink',
        handler: ({ client, agentPath }, input) => client.delete(`/v1/agents/${agentPath}/skills?ref=${encodeURIComponent(requiredString(input, 'ref'))}`),
    },
];
