/**
 * @file src/tool-dispatch/app-manage-call.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_app_manage for the connector MCP server and the CLI dispatch: one function
 *   both call, which checks the call against its action's field list and sends it to the node's own
 *   REST endpoint. The node MCP server calls the services those endpoints call (src/mcp/app-manage.ts
 *   and src/mcp/app-manage-members.ts), every action included, and never this function.
 *
 *   A `switch` with literal client calls, not a lookup table: check:field-reach pairs a tool with a
 *   route by the REST calls it can see, and it does not follow a table.
 * @structure appManageCall
 * @usage return out(await appManageCall(client, owner, input));
 * @version-history
 *   2026-10-05 -- MEMBER_ACTIONS removed: the node MCP server calls the member, plan, audit-keeping,
 *     builder and spec services directly; aimeat_app_manage calls the service in place of the route
 *     over loopback HTTP (secaudit 2026-10, M6). The connector and the CLI still send every action here.
 *   2026-10-02 -- spec, spec_set and spec_clear over GET, PUT and DELETE .../design-spec, with the
 *     member actions (the route decides who is inside the build).
 *   2026-10-02 -- builders, builder_set and builder_remove over GET, PUT and DELETE
 *     /v1/apps/:owner/:filename/dev-grants; dev_level is sent as the route's `level`.
 *   2026-10-01 -- Keeping the audit log: audit sends year as ?archive=, audit_archive and audit_keep go
 *     over their routes (and so, on the node, through the loopback with the member actions).
 *   2026-10-01 -- IAM round 2: member_set sends email and locale, members sends q, limit and offset as a query,
 *     member_plan_set sends manage_roles as manageRoles, and member_audit and member_invite_cancel
 *     reach GET .../members/audit and DELETE .../members/invites/:id.
 *   2026-10-01 -- The member actions, over the /v1/apps/:owner/:filename/members routes. Tool fields
 *     are snake_case and the routes read camelCase (expires_at -> expiresAt, roster_visibility ->
 *     rosterVisibility); an empty expires_at is sent as null, the route's "does not end".
 *   2026-09-28 -- config_get and config_set over GET and PUT /v1/apps/:owner/:filename/config.
 *   2026-09-27 -- Agent-facing texts use industry terms: door and surface became tool and interface (docs/coding-guidelines/shell-and-git.md).
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import type { AimeatClient, ApiResponse } from './api-client.js';
import { checkAppManageInput, uiReadQuery } from '../tool-catalog/definitions/app-manage.js';

type Input = Record<string, unknown>;

/** The named fields that are present, as one body. Absent means "leave it alone". */
function pick(input: Input, fields: string[]): Input {
    const out: Input = {};
    for (const f of fields) if (input[f] !== undefined && input[f] !== null) out[f] = input[f];
    return out;
}

const enc = encodeURIComponent;

/** The named fields that are present, as a query string with its `?`, or '' when none is. */
function query(input: Input, fields: string[]): string {
    const parts = fields.filter(f => input[f] !== undefined && input[f] !== null && input[f] !== '')
        .map(f => `${f}=${enc(String(input[f]))}`);
    return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Run one aimeat_app_manage call over REST. `owner` is the caller's own account, the default for
 * every action that names an app. `extra` names parameters the interface adds itself (the
 * connector's agent_name), which the field check ignores.
 */
export async function appManageCall(client: AimeatClient, owner: string, input: Input, extra: string[] = []): Promise<ApiResponse> {
    const checked = checkAppManageInput(input, extra);
    if (!checked.ok) return { ok: false, error: { code: 'INVALID_INPUT', message: checked.message } };
    const file = enc(String(input.filename ?? ''));
    const ownerName = typeof input.owner === 'string' && input.owner ? input.owner : owner;
    const app = `/v1/apps/${enc(ownerName)}/${file}`;
    const provenance = pick(input, ['ai_provenance', 'ai_provenance_id']);

    switch (checked.action) {
        case 'settings':
            return client.patch(`/v1/apps/${file}`, pick(input, ['owner', 'name', 'description', 'descriptions', 'parked', 'forkable', 'access_code', 'protection']));
        case 'seo':
            return client.patch(`/v1/apps/${file}`, { seo: pick(input, ['index', 'title', 'description', 'keywords', 'image', 'lang']) });
        case 'marks':
            return client.patch(`/v1/apps/${file}`, { marks: pick(input, ['badge', 'install', 'aiUse']) });
        case 'legal': {
            // No kind is a question: `me` in the owner slot, the node resolves the account.
            if (!input.kind) return client.get(`/v1/apps/me/${file}/legal`);
            // The route records the provenance declaration itself and echoes it in the answer.
            return client.patch(`/v1/apps/${file}`, { legal: { [String(input.kind)]: pick(input, ['format', 'content', 'remove']) }, ...provenance });
        }
        case 'audit': {
            const playtest = input.playtest ? '&playtest=true' : '';
            const year = typeof input.year === 'string' && input.year ? `&archive=${enc(input.year)}` : '';
            return client.get(`/v1/apps/me/${file}/audit?limit=${Number(input.limit ?? 50)}${playtest}${year}`);
        }
        case 'audit_archive':
            return client.post(`${app}/audit/archive`, { before: input.before });
        case 'audit_keep': {
            if (input.keep === undefined || input.keep === null || input.keep === '') return client.get('/v1/audit/apps/settings');
            const raw = String(input.keep).trim().toLowerCase();
            // "all" and "default" are words; anything else is sent as the number it reads as, and the
            // route refuses what is not a whole number.
            const keep = raw === 'all' ? 'all' : raw === 'default' ? null : Number(raw);
            return client.put('/v1/audit/apps/settings', { keep });
        }
        case 'versions':
            return client.get(`${app}/versions`);
        case 'lineage':
            return client.get(`${app}/lineage`);
        case 'screenshot':
            return client.post(`${app}/screenshot/capture`, {});
        case 'screenshot_upload':
            return client.post(`${app}/screenshot`, pick(input, ['screenshot', 'screenshot_mime_type']));
        case 'screenshot_clear':
            return client.delete(`${app}/screenshot`);
        case 'preview_link':
            return client.post(`${app}/draft/preview-token`, {});
        case 'visitors': {
            const days = input.days !== undefined ? `&days=${Number(input.days)}` : '';
            return client.get(`/v1/apps/visitors?filename=${file}${days}`);
        }
        case 'visitors_measure':
            return client.put('/v1/apps/visitors/measurement', pick(input, ['filename', 'on', 'geo']));
        case 'ui_get':
            return client.get(`/v1/apps/${enc(owner)}/${file}/ui${uiReadQuery(input.detail)}`);
        case 'ui_set': {
            const layout = (input.layout ?? {}) as Record<string, unknown>;
            const withNote = input.note ? { ...layout, meta: { ...((layout.meta as object) ?? {}), note: input.note } } : layout;
            return client.put(`/v1/apps/${enc(owner)}/${file}/ui`, { layout: withNote, ...provenance });
        }
        case 'ui_restore':
            return client.post(`/v1/apps/${enc(owner)}/${file}/ui/restore`, { version: input.version });
        case 'config_get':
            return client.get(`${app}/config`);
        case 'config_set':
            return client.put(`${app}/config`, { values: input.values });
        case 'cost':
            return client.get(`/v1/apps/cost?app_id=${enc(`${ownerName}/${String(input.filename)}`)}`);
        case 'agent_deploy':
            return client.post(`${app}/agents/${enc(String(input.bundled_agent))}/deploy`, pick(input, ['runner_agent', 'organism_id']));
        case 'agent_undeploy':
            return client.post(`${app}/agents/${enc(String(input.bundled_agent))}/undeploy`, pick(input, ['runner_agent']));
        case 'agent_instances':
            return client.get(`${app}/agents/${enc(String(input.bundled_agent))}/instances`);
        case 'agent_status': {
            const runner = input.runner_agent ? `?runner_agent=${enc(String(input.runner_agent))}` : '';
            return client.get(`${app}/agents/${enc(String(input.bundled_agent))}/status${runner}`);
        }
        case 'grants':
            return client.get('/v1/app-grants');
        case 'backup_export':
            return client.get('/v1/apps/backup?to=storage');
        case 'subdomain_list':
            return client.get('/v1/admin/subdomains');
        case 'subdomain_set': {
            const sub = String(input.subdomain);
            const body: Input = pick(input, ['target', 'enabled']);
            if (input.subdomain_kind !== undefined) body.kind = input.subdomain_kind;
            // Change it when it exists, create it when it does not: the route pair has no upsert.
            const updated = await client.patch(`/v1/admin/subdomains/${enc(sub)}`, body);
            if (updated.ok || updated.error?.code !== 'NOT_FOUND') return updated;
            return client.post('/v1/admin/subdomains', { subdomain: sub, ...body });
        }
        case 'subdomain_delete':
            return client.delete(`/v1/admin/subdomains/${enc(String(input.subdomain))}`);
        // The member paths are written out from /v1 rather than from `app`: check:field-reach reads a
        // path that starts with a computed part as no path at all, and then pairs no route with this
        // tool. Spelled out, the member routes count this tool as their twin.
        case 'members':
            return client.get(`/v1/apps/${enc(ownerName)}/${file}/members${query(input, ['q', 'limit', 'offset'])}`);
        case 'member_set': {
            const body: Input = pick(input, ['account', 'email', 'locale', 'role', 'level', 'note', 'offerings', 'days']);
            if (input.expires_at !== undefined && input.expires_at !== null) body.expiresAt = input.expires_at === '' ? null : input.expires_at;
            return client.post(`/v1/apps/${enc(ownerName)}/${file}/members`, body);
        }
        case 'member_remove':
            return client.delete(`/v1/apps/${enc(ownerName)}/${file}/members/${enc(String(input.account))}`);
        case 'member_decline':
            return client.delete(`/v1/apps/${enc(ownerName)}/${file}/members/requests/${enc(String(input.account))}`);
        case 'member_dismiss':
            return client.delete(`/v1/apps/${enc(ownerName)}/${file}/members/seen/${enc(String(input.account))}`);
        case 'member_plan_get':
            return client.get(`/v1/apps/${enc(ownerName)}/${file}/members/plan`);
        case 'member_plan_set': {
            const body: Input = pick(input, ['roles', 'seats', 'terms', 'access']);
            if (input.roster_visibility !== undefined && input.roster_visibility !== null) body.rosterVisibility = input.roster_visibility;
            if (input.manage_roles !== undefined && input.manage_roles !== null) body.manageRoles = input.manage_roles;
            return client.put(`/v1/apps/${enc(ownerName)}/${file}/members/plan`, body);
        }
        case 'member_sweep':
            return client.post(`/v1/apps/${enc(ownerName)}/${file}/members/sweep`, {});
        case 'member_me':
            return client.get(`/v1/apps/${enc(ownerName)}/${file}/members/me`);
        case 'member_request':
            return client.post(`/v1/apps/${enc(ownerName)}/${file}/members/requests`, pick(input, ['note']));
        case 'member_audit':
            return client.get(`/v1/apps/${enc(ownerName)}/${file}/members/audit${query(input, ['limit', 'before'])}`);
        case 'member_invite_cancel':
            return client.delete(`/v1/apps/${enc(ownerName)}/${file}/members/invites/${enc(String(input.invite_id))}`);
        case 'builders':
            return client.get(`/v1/apps/${enc(ownerName)}/${file}/dev-grants`);
        case 'builder_set':
            return client.put(`/v1/apps/${enc(ownerName)}/${file}/dev-grants/${enc(String(input.account))}`,
                { level: input.dev_level, ...pick(input, ['note']) });
        case 'builder_remove':
            return client.delete(`/v1/apps/${enc(ownerName)}/${file}/dev-grants/${enc(String(input.account))}`);
        case 'spec':
            return client.get(`/v1/apps/${enc(ownerName)}/${file}/design-spec`);
        case 'spec_set':
            return client.put(`/v1/apps/${enc(ownerName)}/${file}/design-spec`, pick(input, ['markdown', 'expected_revision']));
        case 'spec_clear':
            return client.delete(`/v1/apps/${enc(ownerName)}/${file}/design-spec`);
        default:
            return { ok: false, error: { code: 'INVALID_INPUT', message: `Unknown action "${checked.action}".` } };
    }
}
