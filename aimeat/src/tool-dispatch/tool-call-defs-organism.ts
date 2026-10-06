/**
 * @file src/tool-dispatch/tool-call-defs-organism.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Public-memory, organism, workspace and schedule connect-call tool definitions. Extracted from cli/connect/tool-call.ts to satisfy max-file-lines.
 * @version-history
 *   2026-10-01 — aimeat_organism_create forwards `shape` and `lang` (starting shapes).
 *   2026-09-30 — aimeat_workspace_comment_delete handler (DELETE /v1/organisms/:id/comments/:commentId).
 *   2026-09-28 — aimeat_organism_update passes agent_access.
 *   2026-09-27 -- aimeat_schedule_list forwards detail (GET /v1/schedules?detail=true); aimeat_schedule_update forwards prompt with the rest.
 *   v1.6.0 -- 2026-09-25 -- aimeat_workspace_space_add, _sections_set and _suggestions reach the node's
 *     member change doors; _update forwards `member_changes`; _write files a document under a section,
 *     and _object_delete takes a deleted one out, through the section door (workspace-section-filing.ts),
 *     where both wrote the index with POST /v1/memory and read no answer.
 *   v1.5.0 -- 2026-09-06 -- organism get/join/leave/members read `organism_id`, the name the catalog
 *     publishes and the rest of this file already used. They read `id`, so the dispatch refused the
 *     published name and all four were unreachable. join carries `message`, members carries
 *     role/status -- both read by their routes and dropped here.
 *   v1.4.0 -- 2026-08-25 -- aimeat_organism_member_remove handler, so a fleet agent's call reaches the
 *     same route the two MCP doors use, `ban` included.
 *   v1.3.0 -- 2026-08-13 -- Add the aimeat_schedule_trigger connect-call handler (POST
 *     /v1/schedules/:id/trigger), parity with both MCP surfaces.
 *   v1.2.0 -- 2026-07-31 -- workspace_write takes `items: [...]` (batch, all-or-nothing) through the
 *     shared services/workspace-write-items normalisation — parity with both MCP surfaces.
 *   v1.1.0 -- 2026-07-16 -- invite passes role + workspaces; add member_add / invitation_update /
 *     invitation_cancel handlers (name-invite parity with the server MCP).
 *   v1.0.0 -- 2026-07-13 -- Extracted from tool-call.ts (max-file-lines)
 */
import { randomUUID } from 'node:crypto';
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalNumber, optionalArray, optionalBoolean, requiredArray, coerceObject, wsRoot } from './tool-call-helpers.js';
import { unfileThroughDoor, sectionsFromRead } from './workspace-section-filing.js';

export const organismTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_memory_read_public',
        handler: ({ client }, input) => client.get(`/v1/memory/${encodeURIComponent(requiredString(input, 'gaii'))}/${encodeURIComponent(requiredString(input, 'key'))}`),
    },
    {
        name: 'aimeat_organism_list',
        // Public discovery + the agent's own (possibly private) organisms. A bare GET /v1/organisms
        // is public-only, so an agent could not list an organism it is already a member of (join
        // answered ALREADY_MEMBER while this list omitted it). Mirrors the server-MCP tool.
        handler: async ({ client, config }) => {
            const [pub, mine] = await Promise.all([
                client.get('/v1/organisms'),
                client.get(`/v1/organisms?member=${encodeURIComponent(config.owner)}`),
            ]);
            if (pub.ok === false && mine.ok === false) return pub;
            const mineList = ((mine.data as { organisms?: { id: string }[] } | undefined)?.organisms) ?? [];
            const pubList = ((pub.data as { organisms?: { id: string }[] } | undefined)?.organisms) ?? [];
            const memberIds = new Set(mineList.map(o => o.id));
            const seen = new Set<string>();
            const organisms = [...mineList, ...pubList]
                .filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true; })
                .map(o => ({ ...o, is_member: memberIds.has(o.id) }));
            return { ...(pub.ok !== false ? pub : mine), data: { organisms, total: organisms.length } };
        },
    },
    {
        name: 'aimeat_organism_get',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}`),
    },
    {
        name: 'aimeat_organism_overview',
        // The route spells it includeArchived.
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/overview${query({
            includeArchived: optionalBoolean(input, 'include_archived') ? 'true' : undefined,
        })}`),
    },
    {
        name: 'aimeat_organism_update',
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const name = optionalString(input, 'name'); if (name !== undefined) body.name = name;
            const description = optionalString(input, 'description'); if (description !== undefined) body.description = description;
            const readme = optionalString(input, 'readme'); if (readme !== undefined) body.readme = readme;
            const interests = optionalArray(input, 'interests'); if (interests) body.interests = interests;
            const joinPolicy = optionalString(input, 'join_policy'); if (joinPolicy) body.join_policy = joinPolicy;
            const visibility = optionalString(input, 'visibility'); if (visibility) body.visibility = visibility;
            const agentAccess = optionalString(input, 'agent_access'); if (agentAccess) body.agent_access = agentAccess;
            return client.put(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}`, body);
        },
    },
    {
        name: 'aimeat_organism_join',
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const message = optionalString(input, 'message'); if (message !== undefined) body.message = message;
            return client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/join`, body);
        },
    },
    {
        name: 'aimeat_organism_leave',
        handler: ({ client }, input) => client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/leave`),
    },
    {
        name: 'aimeat_organism_members',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/members${query({ role: optionalString(input, 'role'), status: optionalString(input, 'status') })}`),
    },
    // ── Organism create / backup (parity with the appdev MCP surface; thin REST wrappers, authz server-side) ──
    {
        name: 'aimeat_organism_create',
        handler: ({ client }, input) => {
            const body: JsonObject = { name: requiredString(input, 'name') };
            const description = optionalString(input, 'description'); if (description) body.description = description;
            const type = optionalString(input, 'type'); if (type) body.type = type;
            const joinPolicy = optionalString(input, 'join_policy'); if (joinPolicy) body.join_policy = joinPolicy;
            const visibility = optionalString(input, 'visibility'); if (visibility) body.visibility = visibility;
            const shape = optionalString(input, 'shape'); if (shape) body.shape = shape;
            const lang = optionalString(input, 'lang'); if (lang) body.lang = lang;
            return client.post('/v1/organisms', body);
        },
    },
    {
        name: 'aimeat_organism_export',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/export${query({ format: 'base64' })}`),
    },
    {
        name: 'aimeat_organism_import',
        handler: ({ client }, input) => client.post('/v1/organisms/import', { zip_base64: requiredString(input, 'zip_base64') }),
    },
    {
        name: 'aimeat_organism_invite',
        handler: ({ client }, input) => {
            const body: JsonObject = { invitee: requiredString(input, 'invitee') };
            const role = optionalString(input, 'role'); if (role) body.role = role;
            const workspaces = optionalArray(input, 'workspaces'); if (workspaces) body.workspaces = workspaces;
            return client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/invitations`, body);
        },
    },
    {
        name: 'aimeat_organism_member_add',
        handler: ({ client }, input) => {
            const body: JsonObject = { ghii: requiredString(input, 'ghii') };
            const role = optionalString(input, 'role'); if (role) body.role = role;
            const workspaces = optionalArray(input, 'workspaces'); if (workspaces) body.workspaces = workspaces;
            return client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/members`, body);
        },
    },
    {
        name: 'aimeat_organism_member_remove',
        handler: ({ client }, input) => {
            // `ban` rides the query string, exactly as the web door sends it.
            const ban = optionalBoolean(input, 'ban') === true ? '?ban=1' : '';
            return client.delete(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/members/${encodeURIComponent(requiredString(input, 'ghii'))}${ban}`);
        },
    },
    {
        name: 'aimeat_organism_invitation_update',
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            const role = optionalString(input, 'role'); if (role) body.role = role;
            const workspaces = optionalArray(input, 'workspaces'); if (workspaces) body.workspaces = workspaces;
            return client.patch(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/invitations/${encodeURIComponent(requiredString(input, 'invitee'))}`, body);
        },
    },
    {
        name: 'aimeat_organism_invitation_cancel',
        handler: ({ client }, input) => client.delete(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/invitations/${encodeURIComponent(requiredString(input, 'invitee'))}`),
    },
    {
        name: 'aimeat_organism_invitations',
        handler: ({ client }) => client.get('/v1/organisms/invitations/mine'),
    },
    {
        name: 'aimeat_organism_invitation_respond',
        handler: ({ client }, input) => {
            const decision = requiredString(input, 'decision') === 'accept' ? 'accept' : 'decline';
            return client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/invitations/${decision}`, {});
        },
    },
    {
        name: 'aimeat_organism_search',
        handler: ({ client }, input) => {
            const ws = optionalString(input, 'ws');
            // An archive SCOPE — "exclude" (default), "only", "include" — not a flag. The route reads
            // `archived=only` and `includeArchived=true`; `archived=include` reached it as nothing, so
            // a search asked to include the archive searched without it.
            const archived = optionalString(input, 'archived');
            return client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/search${query({
                q: requiredString(input, 'q'),
                ...(ws ? { ws } : {}),
                archived: archived === 'only' ? 'only' : undefined,
                includeArchived: archived === 'include' ? 'true' : undefined,
            })}`);
        },
    },
    {
        name: 'aimeat_workspace_comment',
        handler: ({ client }, input) => {
            const body: JsonObject = {
                ws: requiredString(input, 'ws'), space: requiredString(input, 'space'),
                instance_id: requiredString(input, 'instance_id'), body: requiredString(input, 'body'),
            };
            if (input && typeof input === 'object' && 'anchor' in input && input.anchor != null) body.anchor = (input as JsonObject).anchor;
            const parentId = optionalString(input, 'parent_id'); if (parentId) body.parent_id = parentId;
            return client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/comments`, body);
        },
    },
    {
        name: 'aimeat_workspace_comments',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/comments${query({ ws: requiredString(input, 'ws'), space: requiredString(input, 'space'), instance_id: requiredString(input, 'instance_id') })}`),
    },
    {
        name: 'aimeat_workspace_comment_delete',
        handler: ({ client }, input) => client.delete(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/comments/${encodeURIComponent(requiredString(input, 'comment_id'))}${query({ ws: requiredString(input, 'ws'), space: requiredString(input, 'space'), instance_id: requiredString(input, 'instance_id') })}`),
    },
    // ── Workspace ROW spaces. This is the door a fleet daemon actually calls, and it is the one a
    //    parameter added to the other two has historically failed to reach. ──
    {
        name: 'aimeat_workspace_rows_append',
        handler: ({ client }, input) => {
            const org = encodeURIComponent(requiredString(input, 'organism_id'));
            const space = encodeURIComponent(requiredString(input, 'space'));
            const rows = Array.isArray(input.rows) ? input.rows : null;
            const payload: JsonObject = rows?.length
                ? { rows }
                : { body: input.body, row_id: input.row_id, occurred_at: input.occurred_at };
            return client.post(`/v1/organisms/${org}/workspace/rows/${space}${query({ ws: requiredString(input, 'ws') })}`, payload);
        },
    },
    {
        name: 'aimeat_workspace_rows_read',
        handler: ({ client }, input) => {
            const org = encodeURIComponent(requiredString(input, 'organism_id'));
            const space = encodeURIComponent(requiredString(input, 'space'));
            // Every declared field in `where` rides the query string as itself: the route reads any
            // non-reserved parameter as a filter, and refuses one the space does not index.
            const params: Record<string, string | undefined> = { ws: requiredString(input, 'ws') };
            const where = input.where;
            if (where && typeof where === 'object' && !Array.isArray(where)) {
                for (const [k, v] of Object.entries(where as JsonObject)) if (v != null) params[k] = String(v);
            }
            params.since = optionalString(input, 'since');
            params.until = optionalString(input, 'until');
            params.changed_since = optionalString(input, 'changed_since');
            params.cursor = optionalString(input, 'cursor');
            params.order = optionalString(input, 'order');
            if (typeof input.limit === 'number') params.limit = String(input.limit);
            return client.get(`/v1/organisms/${org}/workspace/rows/${space}${query(params)}`);
        },
    },
    {
        name: 'aimeat_workspace_rows_stats',
        handler: ({ client }, input) => {
            const org = encodeURIComponent(requiredString(input, 'organism_id'));
            const space = encodeURIComponent(requiredString(input, 'space'));
            return client.get(`/v1/organisms/${org}/workspace/rows/${space}/stats${query({ ws: requiredString(input, 'ws') })}`);
        },
    },
    {
        name: 'aimeat_workspace_rows_delete',
        handler: ({ client }, input) => {
            const org = encodeURIComponent(requiredString(input, 'organism_id'));
            const space = encodeURIComponent(requiredString(input, 'space'));
            const ws = requiredString(input, 'ws');
            const rowId = optionalString(input, 'row_id');
            const before = optionalString(input, 'before');
            if (!!rowId === !!before) {
                throw new Error('Pass exactly one of `row_id` (remove that row) or `before` (remove everything created before that ISO timestamp).');
            }
            return rowId
                ? client.delete(`/v1/organisms/${org}/workspace/rows/${space}/${encodeURIComponent(rowId)}${query({ ws })}`)
                : client.delete(`/v1/organisms/${org}/workspace/rows/${space}${query({ ws, before })}`);
        },
    },
    // ── In-place DOCUMENT edits. Same door, same reason as the row entries above: this is what a
    //    fleet daemon actually calls, and it is the surface a parameter added to the other two has
    //    historically failed to reach. `section` is optional on the append and required on the
    //    replace, and both ride in the BODY — the route reads nothing about the edit from the URL.
    {
        name: 'aimeat_workspace_doc_append',
        handler: ({ client }, input) => {
            const org = encodeURIComponent(requiredString(input, 'organism_id'));
            const space = encodeURIComponent(requiredString(input, 'space'));
            const docId = encodeURIComponent(requiredString(input, 'id'));
            const section = optionalString(input, 'section');
            return client.post(
                `/v1/organisms/${org}/workspace/documents/${space}/${docId}/append${query({ ws: requiredString(input, 'ws') })}`,
                { markdown: requiredString(input, 'markdown'), ...(section ? { section } : {}) },
            );
        },
    },
    {
        name: 'aimeat_workspace_doc_section_replace',
        handler: ({ client }, input) => {
            const org = encodeURIComponent(requiredString(input, 'organism_id'));
            const space = encodeURIComponent(requiredString(input, 'space'));
            const docId = encodeURIComponent(requiredString(input, 'id'));
            return client.post(
                `/v1/organisms/${org}/workspace/documents/${space}/${docId}/section${query({ ws: requiredString(input, 'ws') })}`,
                { section: requiredString(input, 'section'), markdown: requiredString(input, 'markdown') },
            );
        },
    },
    // ── Agent SCHEDULES (parity with the agent MCP surface; routes enforce ownership). create/list/
    //    update/delete wrap /v1/schedules; report_internal is a structured memory write (no REST route). ──
    {
        name: 'aimeat_schedule_create',
        handler: ({ client }, input) => client.post('/v1/schedules', input),
    },
    {
        name: 'aimeat_schedule_list',
        // → GET /v1/schedules, with ?detail=true for each schedule's prompt.
        handler: ({ client }, input) => client.get(optionalBoolean(input, 'detail') ? '/v1/schedules?detail=true' : '/v1/schedules'),
    },
    {
        name: 'aimeat_schedule_update',
        handler: ({ client }, input) => {
            const id = requiredString(input, 'schedule_id');
            const { schedule_id: _omit, ...rest } = input;
            void _omit;
            return client.patch(`/v1/schedules/${encodeURIComponent(id)}`, rest);
        },
    },
    {
        name: 'aimeat_schedule_delete',
        handler: ({ client }, input) => client.delete(`/v1/schedules/${encodeURIComponent(requiredString(input, 'schedule_id'))}`),
    },
    {
        name: 'aimeat_schedule_trigger',
        handler: ({ client }, input) => client.post(`/v1/schedules/${encodeURIComponent(requiredString(input, 'schedule_id'))}/trigger`, {}),
    },
    {
        name: 'aimeat_schedule_report_internal',
        handler: ({ client, agentPath }, input) => {
            const entries = requiredArray(input, 'entries').map((e) => {
                const obj = (e && typeof e === 'object' && !Array.isArray(e)) ? e as JsonObject : {};
                return { id: typeof obj.id === 'string' ? obj.id : randomUUID(), ...obj };
            });
            return client.post('/v1/memory', {
                key: `agents.${agentPath}.scheduler`,
                value: { version: 1, updatedAt: new Date().toISOString(), entries },
                visibility: 'owner', tags: ['scheduler', 'internal'],
            });
        },
    },
    // ── Organism WORKSPACES (parity with the appdev MCP surface; the routes enforce membership,
    //    schema validation, the creator-gate, and the publish gate — so authz is unchanged here) ──
    {
        name: 'aimeat_workspace_list',
        // The membership-gated discovery route aggregates the registry across ALL member identities and
        // resolves access by owner — a raw /v1/memory prefix read is caller-scoped, so a sub-agent (whose
        // identity ≠ the owner that wrote the registry) would see an empty list.
        handler: async ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const resp = await client.get(`/v1/organisms/${encodeURIComponent(orgId)}/workspaces`);
            if (!resp.ok) return resp;
            const workspaces = (resp.data as { workspaces?: unknown[] } | undefined)?.workspaces ?? [];
            return { ok: true, data: { organism_id: orgId, workspaces } };
        },
    },
    {
        name: 'aimeat_workspace_read',
        // → GET /v1/organisms/:id/workspace/index: readWorkspaceOp(), the index or the named ids,
        // as the node's MCP answers. This definition read GET /v1/organisms/:id/workspace, which reads
        // none of ids, space or include_archived, so every read was the whole workspace.
        handler: ({ client }, input) => {
            const ids = optionalArray(input, 'ids')?.filter((i): i is string => typeof i === 'string');
            return client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspace/index${query({
                ws: requiredString(input, 'ws'),
                ids: ids?.length ? ids.join(',') : undefined,
                space: optionalString(input, 'space'),
                include_archived: optionalBoolean(input, 'include_archived') ? 'true' : undefined,
            })}`);
        },
    },
    {
        name: 'aimeat_workspace_overview',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspace/overview${query({ ws: requiredString(input, 'ws') })}`),
    },
    {
        name: 'aimeat_workspace_write',
        // → POST /v1/organisms/:id/workspace/drafts: writeWorkspaceDraftsOp(), the node MCP tool's own
        // function. Every item is resolved and schema-validated before any is written, each is filed
        // under its section by the node, and one declaration is recorded per item. This definition
        // wrote each draft with POST /v1/memory and filed it with a second call, a copy of all three.
        handler: ({ client }, input) => {
            const body: JsonObject = { ws: requiredString(input, 'ws') };
            for (const field of ['space', 'value', 'id', 'section', 'items', 'ai_provenance', 'ai_provenance_id'] as const) {
                if (input[field] !== undefined) body[field] = input[field];
            }
            return client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspace/drafts`, body);
        },
    },
    {
        name: 'aimeat_workspace_publish',
        handler: ({ client }, input) => {
            const body: JsonObject = { ws: requiredString(input, 'ws'), namespace: requiredString(input, 'namespace'), id: requiredString(input, 'id') };
            // The optimistic lock the route reads; a namespace that requires it refused every publish
            // made here.
            const expected = optionalNumber(input, 'expected_version'); if (expected !== undefined) body.expected_version = expected;
            return client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/publish`, body);
        },
    },
    {
        name: 'aimeat_workspace_revert_to_draft',
        handler: ({ client }, input) => client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/revert`, {
            ws: requiredString(input, 'ws'), namespace: requiredString(input, 'namespace'), id: requiredString(input, 'id'),
        }),
    },
    {
        name: 'aimeat_workspace_update',
        handler: ({ client }, input) => {
            const body: JsonObject = {};
            if (typeof input.name === 'string') body.name = input.name;
            if (typeof input.readme === 'string') body.readme = input.readme;
            const add = coerceObject(input.add_spaces); if (Array.isArray(add)) body.add_spaces = add;
            if (input.manifest !== undefined) body.manifest = coerceObject(input.manifest);
            if (input.schemas !== undefined) body.schemas = coerceObject(input.schemas);
            const apps = coerceObject(input.apps); if (Array.isArray(apps)) body.apps = apps;
            const memberChanges = optionalString(input, 'member_changes'); if (memberChanges !== undefined) body.member_changes = memberChanges;
            if (Object.keys(body).length === 0) throw new Error('Provide a name, readme, add_spaces, manifest, schemas, apps and/or member_changes.');
            return client.put(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspace${query({ ws: requiredString(input, 'ws') })}`, body);
        },
    },
    {
        name: 'aimeat_workspace_create',
        // → POST /v1/organisms/:id/workspaces: provisionWorkspace(), which the node's MCP tool runs too
        // (manifest envelope, space normalisation, schema locks, readme and the registry entry, under
        // the owner). This definition wrote those records itself with POST /v1/memory, without the
        // envelope backfill or the space check, and registered the workspace under whichever
        // identity made the call.
        handler: ({ client }, input) => {
            const body: JsonObject = {
                name: requiredString(input, 'name'),
                manifest: coerceObject(input.manifest) as JsonObject,
            };
            if (input.schemas !== undefined) body.schemas = coerceObject(input.schemas) as JsonObject;
            const readme = optionalString(input, 'readme'); if (readme !== undefined) body.readme = readme;
            return client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspaces`, body);
        },
    },
    {
        name: 'aimeat_workspace_object_delete',
        handler: async ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const ws = requiredString(input, 'ws');
            const namespace = requiredString(input, 'namespace');
            const id = requiredString(input, 'id');
            const base = `${wsRoot(orgId, ws)}.${namespace}.${id}`;
            // Prefix `${base}` (no trailing dot) catches the bare un-suffixed key too — workspace_read
            // surfaces it as the current value, so it must be deletable. Per-row guard excludes sibling
            // ids (`${base}0`). limit=200 is the REST cap; for a huge version history, re-run (idempotent).
            const listed = await client.get(`/v1/memory${query({ prefix: base, limit: 200 })}`);
            if (!listed.ok) return listed;
            const items = (listed.data as { items?: { key: string }[] } | undefined)?.items ?? [];
            let deleted = 0;
            for (const it of items) {
                if (it.key !== base && !it.key.startsWith(base + '.')) continue;  // exclude sibling ids
                const role = it.key === base ? '' : it.key.slice(base.length + 1);
                if (role === '' || role === 'draft' || role === 'latest' || /^version\.\d+$/.test(role)) {
                    const dr = await client.delete(`/v1/memory/${encodeURIComponent(it.key)}`);
                    if (dr.ok) deleted++;
                }
            }
            if (deleted === 0) return { ok: false, error: { code: 'NOT_FOUND', message: `Nothing to delete at ${base} (no record/draft/latest/version).` } };
            // Take the id out of the document space's section index through the node's section door.
            const wsResp = await client.get(`/v1/organisms/${encodeURIComponent(orgId)}/workspace${query({ ws })}`);
            const ot = ((wsResp.data as { manifest?: { objectTypes?: { name: string; namespace?: string }[] } } | undefined)?.manifest?.objectTypes ?? []).find(o => o.namespace === namespace);
            const unfiled = ot ? await unfileThroughDoor(client, { orgId, ws, space: ot.name, doc: id }, sectionsFromRead(wsResp.data)) : null;
            return { ok: true, data: { deleted: base, keys: deleted, ...(unfiled ? { section_unfiling: unfiled as unknown as JsonObject } : {}) } };
        },
    },
    {
        name: 'aimeat_workspace_access',
        handler: ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const ws = requiredString(input, 'ws');
            const action = requiredString(input, 'action');
            const orgPath = `/v1/organisms/${encodeURIComponent(orgId)}/workspace-access`;
            if (action === 'list') return client.get(`${orgPath}${query({ ws })}`);
            if (action === 'decide') {
                const requester = optionalString(input, 'requester');
                if (!requester) throw new Error("action='decide' needs a requester.");
                const body: JsonObject = { ws, requester, decision: optionalString(input, 'decision') === 'deny' ? 'deny' : 'approve' };
                const role = optionalString(input, 'role'); if (role === 'viewer' || role === 'contributor') body.role = role;
                return client.post(`${orgPath}/decision`, body);
            }
            if (action === 'request') {
                const body: JsonObject = { ws };
                const message = optionalString(input, 'message'); if (message != null) body.message = message;
                return client.post(orgPath, body);
            }
            throw new Error("action must be 'request', 'list' or 'decide'.");
        },
    },
    {
        name: 'aimeat_workspace_member_grant',
        handler: async ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const grantee = requiredString(input, 'grantee');
            const role = requiredString(input, 'role');
            if (role !== 'viewer' && role !== 'contributor') throw new Error("role must be 'viewer' or 'contributor'.");
            const targets = [...new Set([
                ...(optionalString(input, 'ws') ? [optionalString(input, 'ws') as string] : []),
                ...(optionalArray(input, 'workspaces') ?? []).filter((w): w is string => typeof w === 'string' && w.trim() !== ''),
            ])];
            if (!targets.length) throw new Error('Provide `ws` and/or `workspaces`.');
            const orgPath = `/v1/organisms/${encodeURIComponent(orgId)}/workspace-access/grant`;
            const results: Array<{ ws: string; status: string; role?: string }> = [];
            for (const w of targets) {
                const r = await client.post(orgPath, { ws: w, grantee, role });
                results.push(r.ok === false ? { ws: w, status: 'forbidden_or_not_found' } : { ws: w, status: 'granted', role });
            }
            const data = { grantee, role, granted: results.filter(r => r.status === 'granted').length, total: targets.length, results };
            // Refused on every workspace is a refusal, not a grant of nothing.
            return results.every(r => r.status === 'forbidden_or_not_found')
                ? { ok: false, data, error: { code: 'ACCESS_DENIED', message: 'Every workspace refused the grant: the workspace does not exist, or you are neither its creator nor an organism admin.' } }
                : { ok: true, data };
        },
    },
    {
        name: 'aimeat_workspace_member_revoke',
        handler: async ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const grantee = requiredString(input, 'grantee');
            const targets = [...new Set([
                ...(optionalString(input, 'ws') ? [optionalString(input, 'ws') as string] : []),
                ...(optionalArray(input, 'workspaces') ?? []).filter((w): w is string => typeof w === 'string' && w.trim() !== ''),
            ])];
            if (!targets.length) throw new Error('Provide `ws` and/or `workspaces`.');
            const orgPath = `/v1/organisms/${encodeURIComponent(orgId)}/workspace-access/revoke`;
            const results: Array<{ ws: string; status: string; revoked?: number }> = [];
            for (const w of targets) {
                const r = await client.post(orgPath, { ws: w, grantee });
                if (r.ok === false) { results.push({ ws: w, status: 'forbidden_or_not_found' }); continue; }
                const n = Number((r.data as { revoked?: number } | undefined)?.revoked ?? 0);
                results.push({ ws: w, status: n > 0 ? 'revoked' : 'not_a_member', revoked: n });
            }
            const data = { grantee, revoked: results.filter(r => r.status === 'revoked').length, total: targets.length, results };
            // `not_a_member` is an answer; refused on every workspace is a refusal.
            return results.every(r => r.status === 'forbidden_or_not_found')
                ? { ok: false, data, error: { code: 'ACCESS_DENIED', message: 'Every workspace refused the revoke: the workspace does not exist, or you are neither its creator nor an organism admin.' } }
                : { ok: true, data };
        },
    },
    {
        name: 'aimeat_workspace_members',
        // The route answers the access panel ({ ws, requests, members }); this tool answers the members.
        handler: async ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const ws = requiredString(input, 'ws');
            const resp = await client.get(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access${query({ ws })}`);
            if (!resp.ok) return resp;
            return { ...resp, data: { ws, members: (resp.data as { members?: unknown[] } | undefined)?.members ?? [] } };
        },
    },
    // ── A member's change to a workspace, and the decision on a member's suggestion: the node's REST
    //    doors, which apply the workspace's rule and decide who may decide. ──
    {
        name: 'aimeat_workspace_space_add',
        handler: ({ client }, input) => {
            const body: JsonObject = { spaces: coerceObject(input.spaces) as JsonObject };
            if (input.schemas !== undefined) body.schemas = coerceObject(input.schemas) as JsonObject;
            return client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspace/spaces${query({ ws: requiredString(input, 'ws') })}`, body);
        },
    },
    {
        name: 'aimeat_workspace_sections_set',
        handler: ({ client }, input) => client.put(
            `/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspace/sections/${encodeURIComponent(requiredString(input, 'space'))}${query({ ws: requiredString(input, 'ws') })}`,
            { sections: coerceObject(input.sections) as JsonObject },
        ),
    },
    {
        name: 'aimeat_workspace_suggestions',
        handler: ({ client }, input) => {
            const base = `/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspace/suggestions`;
            const action = requiredString(input, 'action');
            if (action === 'list') return client.get(`${base}${query({ ws: optionalString(input, 'ws'), status: optionalString(input, 'status') })}`);
            if (action === 'decide') {
                const sid = optionalString(input, 'suggestion_id');
                if (!sid) throw new Error("action='decide' needs a suggestion_id: list them with action='list'.");
                const body: JsonObject = {};
                const decision = optionalString(input, 'decision'); if (decision !== undefined) body.decision = decision;
                const note = optionalString(input, 'note'); if (note !== undefined) body.note = note;
                return client.post(`${base}/${encodeURIComponent(sid)}`, body);
            }
            throw new Error("action must be 'list' or 'decide'.");
        },
    },
    // NOTE: the organism email-invitation tools (aimeat_organism_invite_email / _invitations_email /
    // _invitation_email_cancel) are NOT cliFallback — they are exposed on the connector MCP surface
    // (mcp/tools/organisms.ts) but intentionally have no `aimeat connect call` shell handler, so no orphan
    // handler is added here.
];
