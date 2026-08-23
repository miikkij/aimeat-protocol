/**
 * @file cli/connect/tool-call-defs-core.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
import { query, requiredString, optionalString, requiredValue, optionalNumber, optionalBoolean, optionalArray, optionalRecord, requiredRecord, requiredArray } from './tool-call-helpers.js';
import type { ApiResponse } from './api-client.js';

/**
 * The compliance register's `part`, checked against the two documents that exist.
 *
 * It becomes a path segment, so an unchecked value would build a URL the route never declared and
 * the caller would read the resulting 404 as "the report is empty" rather than "you asked for
 * something that is not a thing".
 */
function compliancePart(input: JsonObject): 'usecases' | 'questionnaire' {
    const part = requiredString(input, 'part');
    if (part !== 'usecases' && part !== 'questionnaire') {
        throw new Error(`part has to be "usecases" or "questionnaire", not "${part}"`);
    }
    return part;
}

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
        // THE THIRD SURFACE, and the one a fleet actually uses. /local/call/<tool> dispatches through
        // CONNECT_CLI_TOOLS, not through either MCP registration, so a parameter added to both MCP
        // doors still never reaches the node from here. Found by a crew whose 61 agents go through
        // this door exclusively: they watched `owner_scope` work on aimeat_memory_list — three
        // entries below, which has always forwarded it — and answer NOT_FOUND here, for the same key
        // with the same token that a direct REST call served in full.
        name: 'aimeat_memory_read',
        handler: ({ client }, input) => client.get(`/v1/memory/${encodeURIComponent(requiredString(input, 'key'))}${query({
            owner_scope: optionalBoolean(input, 'owner_scope') ? 'true' : undefined,
        })}`),
    },
    {
        name: 'aimeat_memory_write',
        handler: ({ client }, input) => {
            const body: JsonObject = { key: requiredString(input, 'key'), value: requiredValue(input, 'value') };
            const visibility = optionalString(input, 'visibility');
            const ttlHours = optionalNumber(input, 'ttl_hours');
            if (visibility) body.visibility = visibility;
            const tags = optionalArray(input, 'tags');
            const groupId = optionalString(input, 'group_id');
            if (tags) body.tags = tags;
            if (ttlHours !== undefined) body.ttl_hours = ttlHours;
            // Required whenever visibility is 'group'. Without it the write is refused, or worse,
            // stored with a visibility the caller asked for and a group the node never heard of.
            if (groupId) body.group_id = groupId;
            // Where the record LIVES, which is a different question from `visibility`, who may read
            // it. Without this every write from this door landed under the agent however the caller
            // meant it, and the owner's own tools could not see it. The route still decides:
            // resolveWriteTarget() refuses without memory:write-as-owner.
            if (optionalBoolean(input, 'owner_scope')) body.owner_scope = true;
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
        handler: ({ client }, input) => client.get(`/v1/memory/search${query({
            q: requiredString(input, 'query'),
            visibility: optionalString(input, 'visibility'),
            limit: optionalNumber(input, 'limit'),
        })}`),
    },
    {
        name: 'aimeat_catalogue_search',
        handler: ({ client }, input) => client.get(`/v1/catalogue${query({
            // `query` is this door's own historical spelling; `search` is what the catalog publishes
            // and what every other surface takes. Both are accepted so neither caller is broken.
            search: optionalString(input, 'search') ?? optionalString(input, 'query'),
            category: optionalString(input, 'category'),
        })}`),
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
            const providerGaii = optionalString(input, 'provider_gaii');
            const ttlHours = optionalNumber(input, 'ttl_hours');
            if (actionInput) body.input = actionInput;
            // WHO is being asked, and for how long the grant lasts. Dropping the first sends the
            // request to whoever the node picks; dropping the second silently takes the default TTL.
            if (providerGaii) body.provider_gaii = providerGaii;
            if (ttlHours !== undefined) body.ttl_hours = ttlHours;
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
        handler: ({ client }, input) => client.get(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts${query({
            category: optionalString(input, 'category'),
            limit: optionalNumber(input, 'limit'),
        })}`),
    },
    {
        name: 'aimeat_board_post',
        handler: ({ client }, input) => {
            const body: JsonObject = { title: requiredString(input, 'title'), body: requiredString(input, 'body') };
            const category = optionalString(input, 'category');
            if (category) body.category = category;
            return client.post(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/posts`, body);
        },
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
            // `inline` asks for the BYTES in the response rather than a handle to fetch. It is the
            // difference between an agent reading a file and an agent being told where one is.
            const inline = optionalBoolean(input, 'inline') === true;
            if (!owner) return client.get(`/v1/storage/${encodeURIComponent(key)}${query({ inline: inline ? 'true' : undefined })}`);
            const refKey = optionalString(input, 'owner') ? key : key.slice(slash + 1);
            return client.get(`/v1/pub/${encodeURIComponent(owner)}/${refKey.split('/').map(encodeURIComponent).join('/')}?mode=${inline ? 'inline' : 'handle'}`);
        },
    },
    {
        name: 'aimeat_datapackage_publish',
        // One door and no twin: publishing goes through /v1/datapackages, which owns the quality
        // gate, the content hash and the address. A connector that assembled a package itself would
        // be the second implementation the whole format exists to prevent.
        handler: ({ client }, input) => client.post('/v1/datapackages', input as JsonObject),
    },
    {
        name: 'aimeat_datapackage_export',
        // Default 'url' answers with the permanent address rather than the rows, so the common case
        // costs one small response instead of a table pulled through a model context.
        handler: ({ client }, input) => {
            const ref = requiredString(input, 'ref');
            const m = /^pkg:([^/@]+)\/([^@]+)(?:@(sha256:[a-f0-9]{64}))?$/.exec(ref);
            if (!m) throw new Error('ref must look like "pkg:owner/name" or "pkg:owner/name@sha256:..."');
            const [, owner, name, version] = m;
            const format = optionalString(input, 'format') ?? 'url';
            const base = `/v1/datapackages/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
            const qs = version ? `?version=${encodeURIComponent(version)}` : '';
            if (format === 'url') return client.get(base + qs);
            return client.get(`${base}/rows/${encodeURIComponent(requiredString(input, 'resource'))}${qs}`);
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
        handler: ({ client }, input) => client.get(`/v1/admin/agents${query({ limit: optionalNumber(input, 'limit') })}`),
    },
    {
        name: 'aimeat_admin_config',
        handler: ({ client }) => client.get('/v1/admin/config'),
    },
    {
        // `part` is validated against the two literals rather than interpolated, because it lands in
        // a path segment. An unchecked value here would be a path the route never declared.
        name: 'aimeat_compliance_report',
        handler: ({ client }, input) => client.get(`/v1/admin/compliance/report${query({
            month: optionalString(input, 'month'),
            since_days: optionalNumber(input, 'since_days'),
        })}`),
    },
    {
        name: 'aimeat_compliance_register_read',
        handler: ({ client }, input) => client.get(`/v1/admin/compliance/${compliancePart(input)}`),
    },
    {
        name: 'aimeat_compliance_register_write',
        handler: ({ client }, input) => client.put(
            `/v1/admin/compliance/${compliancePart(input)}`, requiredRecord(input, 'value'),
        ),
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
            const allowedGaiis = optionalArray(input, 'allowed_gaiis');
            if (description) body.description = description;
            if (visibility) body.visibility = visibility;
            // Without this a shared or private board is created with nobody on it, which reads as
            // "the board is broken" rather than "the guest list never left your machine".
            if (allowedGaiis) body.allowed_gaiis = allowedGaiis;
            return client.post('/v1/boards', body);
        },
    },
    {
        name: 'aimeat_board_subscribe',
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const callbackUrl = optionalString(input, 'callback_url');
            const filters = optionalRecord(input, 'filters');
            if (callbackUrl) body.callback_url = callbackUrl;
            if (filters) body.filters = filters;
            return client.post(`/v1/boards/${encodeURIComponent(requiredString(input, 'board_id'))}/subscribe`, body);
        },
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
        handler: ({ client }, input) => {
            const tags = optionalArray(input, 'tags')?.filter((t): t is string => typeof t === 'string');
            return client.get(`/v1/capabilities${query({
                search: optionalString(input, 'search') ?? optionalString(input, 'query'),
                tags: tags?.length ? tags.join(',') : undefined,
                // `callable` is a flag and arrives either as a boolean (JSON caller) or as the
                // string "true" (shell caller); `authRequired` is NOT a flag at all — the catalog
                // publishes it as an auth LEVEL (none / anonymous / registered), and reading it as a
                // boolean would have turned "registered" into "true".
                callable: optionalBoolean(input, 'callable') || optionalString(input, 'callable') === 'true' ? 'true' : undefined,
                authRequired: optionalString(input, 'authRequired'),
                source_type: optionalString(input, 'source_type'),
            })}`);
        },
    },
    {
        name: 'aimeat_capabilities_get',
        handler: ({ client }, input) => client.get(`/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_capabilities_invoke',
        handler: ({ client }, input) => client.post(
            `/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}/invoke${query({ mode: optionalString(input, 'mode') })}`,
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
            // Every optional field the catalog publishes, not the two this door happened to read.
            for (const field of ['name', 'description', 'summary', 'visibility', 'usage', 'whenToUse', 'whenNotToUse'] as const) {
                const v = optionalString(input, field);
                if (v) body[field] = v;
            }
            const tags = optionalArray(input, 'tags');
            if (tags) body.tags = tags;
            return client.put(`/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}`, body);
        },
    },
    {
        name: 'aimeat_capabilities_delete',
        handler: ({ client }, input) => client.delete(`/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_capabilities_vouch',
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const comment = optionalString(input, 'comment');
            // The vouch is the signature; the comment is the reason anyone would trust it.
            if (comment) body.comment = comment;
            return client.post(`/v1/capabilities/${encodeURIComponent(requiredString(input, 'id'))}/vouch`, body);
        },
    },
    {
        name: 'aimeat_catalogue_agents',
        handler: ({ client }, input) => client.get(`/v1/catalogue/agents${query({
            search: optionalString(input, 'search') ?? optionalString(input, 'query'),
            category: optionalString(input, 'category'),
        })}`),
    },
    {
        name: 'aimeat_catalogue_boards',
        handler: ({ client }) => client.get('/v1/catalogue/boards'),
    },
    {
        name: 'aimeat_catalogue_directory',
        handler: ({ client }, input) => client.get(`/v1/catalogue/directory${query({
            q: optionalString(input, 'query'),
            city: optionalString(input, 'city'),
            interest: optionalString(input, 'interest'),
        })}`),
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
        handler: ({ client }, input) => {
            const body: JsonObject = {
                target_type: requiredString(input, 'target_type'),
                target_id: requiredString(input, 'target_id'),
                reason: requiredString(input, 'reason'),
            };
            const description = optionalString(input, 'description');
            // `reason` is the category; `description` is what actually happened. A report that
            // arrives as a category alone is a report nobody can act on.
            if (description) body.description = description;
            return client.post('/v1/flags', body);
        },
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
            const members = optionalArray(input, 'members');
            if (description) body.description = description;
            // A sharing group created without its members is an empty group, and group visibility
            // then silently shares with nobody.
            if (members) body.members = members;
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
            const model = optionalString(input, 'model');
            if (template) body.template = template;
            if (model) body.model = model;
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
            // `view=workspace` is published in the catalog and was not implemented on either
            // connector door: it fell through to the library listing, so asking for one workspace's
            // skills answered with the whole node's and looked like the workspace had none. The
            // route spells its parameters `organism` and `ws`, not organism_id / workspace_id.
            if (view === 'workspace') {
                return client.get(`/v1/skills${query({
                    scope: 'workspace',
                    organism: optionalString(input, 'organism_id'),
                    ws: optionalString(input, 'workspace_id'),
                    binding: optionalString(input, 'binding'),
                })}`);
            }
            return client.get(`/v1/skills${query({
                scope: view === 'mine' ? 'user' : 'library',
                binding: optionalString(input, 'binding'),
            })}`);
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
