/**
 * @file cli/connect/tool-call-defs-organism.ts
 * @description Public-memory, organism, workspace and schedule connect-call tool definitions. Extracted from cli/connect/tool-call.ts to satisfy max-file-lines.
 * @version-history
 *   v1.2.0 -- 2026-07-31 -- workspace_write takes `items: [...]` (batch, all-or-nothing) through the
 *     shared services/workspace-write-items normalisation — parity with both MCP surfaces.
 *   v1.1.0 -- 2026-07-16 -- invite passes role + workspaces; add member_add / invitation_update /
 *     invitation_cancel handlers (name-invite parity with the server MCP).
 *   v1.0.0 -- 2026-07-13 -- Extracted from tool-call.ts (max-file-lines)
 */
import { randomUUID } from 'node:crypto';
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalArray, requiredArray, coerceObject, stampValue, genWsId, wsRoot } from './tool-call-helpers.js';
import { normalizeWriteItems, resolveWriteItem, type ResolvedWriteItem, type WriteObjectType } from '../../services/workspace-write-items.js';

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
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_organism_overview',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/overview`),
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
            return client.put(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}`, body);
        },
    },
    {
        name: 'aimeat_organism_join',
        handler: ({ client }, input) => client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'id'))}/join`),
    },
    {
        name: 'aimeat_organism_leave',
        handler: ({ client }, input) => client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'id'))}/leave`),
    },
    {
        name: 'aimeat_organism_members',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'id'))}/members`),
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
            return client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/search${query({ q: requiredString(input, 'q'), ...(ws ? { ws } : {}) })}`);
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
    // ── Agent SCHEDULES (parity with the agent MCP surface; routes enforce ownership). create/list/
    //    update/delete wrap /v1/schedules; report_internal is a structured memory write (no REST route). ──
    {
        name: 'aimeat_schedule_create',
        handler: ({ client }, input) => client.post('/v1/schedules', input),
    },
    {
        name: 'aimeat_schedule_list',
        handler: ({ client }) => client.get('/v1/schedules'),
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
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspace${query({ ws: requiredString(input, 'ws') })}`),
    },
    {
        name: 'aimeat_workspace_overview',
        handler: ({ client }, input) => client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspace/overview${query({ ws: requiredString(input, 'ws') })}`),
    },
    {
        name: 'aimeat_workspace_write',
        handler: async ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const ws = requiredString(input, 'ws');
            const norm = normalizeWriteItems({
                space: input.space, value: input.value, id: input.id, section: input.section, items: input.items,
            });
            if ('error' in norm) return { ok: false, error: { code: 'INVALID_INPUT', message: norm.error } };
            const batch = input.items !== undefined && input.items !== null;
            const wsResp = await client.get(`/v1/organisms/${encodeURIComponent(orgId)}/workspace${query({ ws })}`);
            if (!wsResp.ok) return wsResp;
            const types = (wsResp.data as { manifest?: { objectTypes?: WriteObjectType[] } } | undefined)?.manifest?.objectTypes ?? [];
            // Resolve every item before writing any: a document with no id gets a generated one, so a
            // half-written batch the caller retries would duplicate whatever already landed.
            const planned: { key: string; v: unknown; item: ResolvedWriteItem }[] = [];
            for (const [i, want] of norm.items.entries()) {
                const item = resolveWriteItem(want, types, batch ? `items[${i}]` : undefined);
                if ('error' in item) return { ok: false, error: { code: 'NO_SPACE', message: item.error } };
                const key = `${wsRoot(orgId, ws)}.${item.namespace}.${item.instanceId}.draft`;
                planned.push({ key, v: stampValue(coerceObject(item.value), item.instanceId), item });
            }
            const written: JsonObject[] = [];
            for (const { key, v, item } of planned) {
                const wr = await client.post('/v1/memory', { key, value: v, visibility: 'private' });
                if (!wr.ok) return wr;
                if (item.isDoc && item.section) {
                    const secKey = `${wsRoot(orgId, ws)}.meta.sections.${item.space}`;
                    const secResp = await client.get(`/v1/memory${query({ prefix: secKey })}`);
                    const sections = (secResp.data as { items?: { key: string; value?: { sections?: { id: string; name?: string; documents?: string[] }[] } }[] } | undefined)?.items?.find(i => i.key === secKey)?.value?.sections ?? [];
                    const targetSec = sections.find(s => s.id === item.section || s.name === item.section);
                    if (targetSec) { targetSec.documents = [...(targetSec.documents ?? []).filter(d => d !== item.instanceId), item.instanceId]; await client.post('/v1/memory', { key: secKey, value: { sections }, visibility: 'private' }); }
                }
                written.push({ written: key, id: item.instanceId, space: item.space, mode: item.isDoc ? 'document' : 'records', section: item.section ?? null });
            }
            return { ok: true, data: batch ? { count: written.length, items: written } : written[0] };
        },
    },
    {
        name: 'aimeat_workspace_publish',
        handler: ({ client }, input) => client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/publish`, {
            ws: requiredString(input, 'ws'), namespace: requiredString(input, 'namespace'), id: requiredString(input, 'id'),
        }),
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
            if (Object.keys(body).length === 0) throw new Error('Provide a name, readme, add_spaces, manifest and/or schemas.');
            return client.put(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/workspace${query({ ws: requiredString(input, 'ws') })}`, body);
        },
    },
    {
        name: 'aimeat_workspace_create',
        handler: async ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const name = requiredString(input, 'name');
            const man = coerceObject(input.manifest) as JsonObject | undefined;
            if (!man || typeof man !== 'object' || !Array.isArray(man.objectTypes)) return { ok: false, error: { code: 'INVALID_MANIFEST', message: 'manifest must be an object with an objectTypes array.' } };
            const schemaMap = (coerceObject(input.schemas) ?? {}) as Record<string, Record<string, unknown>>;
            const wsId = genWsId();
            const base = wsRoot(orgId, wsId);
            const now = new Date().toISOString();
            // PUT schema is owner/operator-only — an agent token may lack permission, so failures are
            // reported (not fatal); the owner can lock schemas later, matching the appdev MCP behavior.
            const schemaResults: { namespace: string; locked: boolean; error?: string }[] = [];
            for (const [namespace, schema] of Object.entries(schemaMap)) {
                if (!schema || typeof schema !== 'object') continue;
                const r = await client.put(`/v1/memory/${encodeURIComponent(`${base}.${namespace}`)}/schema`, { schema, apply_to: 'prefix', schema_mode: 'strict' });
                schemaResults.push({ namespace, locked: r.ok, ...(r.ok ? {} : { error: r.error?.message }) });
            }
            const manifestValue = { ...man, id: orgId, status: man.status || 'active' };
            const mr = await client.post('/v1/memory', { key: `${base}.meta.manifest`, value: manifestValue, visibility: 'private' });
            if (!mr.ok) return mr;
            const summary = man.summary;
            const readme = optionalString(input, 'readme');
            await client.post('/v1/memory', { key: `${base}.meta.readme`, value: readme || `# ${String(man.name || name)}\n\n${typeof summary === 'string' ? summary : ''}`, visibility: 'private' });
            const regKey = `organism.${orgId}.meta.workspaces`;
            const regResp = await client.get(`/v1/memory${query({ prefix: regKey })}`);
            const workspaces = ((regResp.data as { items?: { key: string; value?: { workspaces?: unknown[] } }[] } | undefined)?.items?.find(i => i.key === regKey)?.value?.workspaces) ?? [];
            await client.post('/v1/memory', { key: regKey, value: { workspaces: [...workspaces, { id: wsId, name: String(name || 'Workspace').trim() || 'Workspace', createdAt: now }] }, visibility: 'private' });
            return { ok: true, data: { created: true, ws: wsId, types: (man.objectTypes as { name: string }[]).map(o => o.name), schemas: schemaResults } };
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
            // Best-effort: unfile the id from the document section tree (find the type by namespace).
            const wsResp = await client.get(`/v1/organisms/${encodeURIComponent(orgId)}/workspace${query({ ws })}`);
            const ot = ((wsResp.data as { manifest?: { objectTypes?: { name: string; namespace?: string }[] } } | undefined)?.manifest?.objectTypes ?? []).find(o => o.namespace === namespace);
            if (ot) {
                const secKey = `${wsRoot(orgId, ws)}.meta.sections.${ot.name}`;
                const secResp = await client.get(`/v1/memory${query({ prefix: secKey })}`);
                const sections = (secResp.data as { items?: { key: string; value?: { sections?: { documents?: string[] }[] } }[] } | undefined)?.items?.find(i => i.key === secKey)?.value?.sections;
                if (sections) {
                    let changed = false;
                    for (const s of sections) { if ((s.documents ?? []).includes(id)) { s.documents = (s.documents ?? []).filter(d => d !== id); changed = true; } }
                    if (changed) await client.post('/v1/memory', { key: secKey, value: { sections }, visibility: 'private' });
                }
            }
            return { ok: true, data: { deleted: base, keys: deleted } };
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
            return { ok: true, data: { grantee, role, granted: results.filter(r => r.status === 'granted').length, total: targets.length, results } };
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
            return { ok: true, data: { grantee, revoked: results.filter(r => r.status === 'revoked').length, total: targets.length, results } };
        },
    },
    {
        name: 'aimeat_workspace_members',
        handler: ({ client }, input) => {
            const orgId = requiredString(input, 'organism_id');
            const ws = requiredString(input, 'ws');
            return client.get(`/v1/organisms/${encodeURIComponent(orgId)}/workspace-access${query({ ws })}`);
        },
    },
    // NOTE: the organism email-invitation tools (aimeat_organism_invite_email / _invitations_email /
    // _invitation_email_cancel) are NOT cliFallback — they are exposed on the connector MCP surface
    // (mcp/tools/organisms.ts) but intentionally have no `aimeat connect call` shell handler, so no orphan
    // handler is added here.
];
