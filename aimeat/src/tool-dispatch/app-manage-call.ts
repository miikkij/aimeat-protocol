/**
 * @file src/tool-dispatch/app-manage-call.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_app_manage for the connector MCP server and the CLI dispatch: one function
 *   both call, which checks the call against its action's field list and sends it to the node's own
 *   REST endpoint. The node MCP server calls the services those endpoints call (src/mcp/app-manage.ts).
 *
 *   A `switch` with literal client calls, not a lookup table: check:field-reach pairs a tool with a
 *   route by the REST calls it can see, and it does not follow a table.
 * @structure appManageCall
 * @usage return out(await appManageCall(client, owner, input));
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import type { AimeatClient, ApiResponse } from './api-client.js';
import { checkAppManageInput, uiReadQuery } from '../mcp/catalog/definitions/app-manage.js';

type Input = Record<string, unknown>;

/** The named fields that are present, as one body. Absent means "leave it alone". */
function pick(input: Input, fields: string[]): Input {
    const out: Input = {};
    for (const f of fields) if (input[f] !== undefined && input[f] !== null) out[f] = input[f];
    return out;
}

const enc = encodeURIComponent;

/**
 * Run one aimeat_app_manage call over REST. `owner` is the caller's own account, the default for
 * every action that names an app. `extra` names parameters the surface adds itself (the
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
            return client.patch(`/v1/apps/${file}`, { marks: pick(input, ['badge', 'install']) });
        case 'legal': {
            // No kind is a question: `me` in the owner slot, the node resolves the account.
            if (!input.kind) return client.get(`/v1/apps/me/${file}/legal`);
            // The route records the provenance declaration itself and echoes it in the answer.
            return client.patch(`/v1/apps/${file}`, { legal: { [String(input.kind)]: pick(input, ['format', 'content', 'remove']) }, ...provenance });
        }
        case 'audit': {
            const playtest = input.playtest ? '&playtest=true' : '';
            return client.get(`/v1/apps/me/${file}/audit?limit=${Number(input.limit ?? 50)}${playtest}`);
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
        default:
            return { ok: false, error: { code: 'INVALID_INPUT', message: `Unknown action "${checked.action}".` } };
    }
}
