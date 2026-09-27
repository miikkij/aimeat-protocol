/**
 * @file cli/connect/tool-call-defs-themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The third surface of Themes & Styles (`aimeat connect call` and POST /local/call):
 *   aimeat_theme_list, aimeat_theme_get, aimeat_theme_save, aimeat_theme_style_save and
 *   aimeat_theme_component_css_set, each forwarding every declared parameter to the /v1/themes
 *   routes. `themeRequests` is the one mapping from a tool's input to its route calls; the connector
 *   MCP (mcp/tools/themes.ts) calls the same function, so the two doors cannot drift. Their own file
 *   because tool-call-defs-apps.ts and tool-call-defs-core.ts sit under the 800-line ceiling.
 * @structure themeCliTools[] -- the shell handler table, registered by tool-call.ts · themeRequests
 * @usage import { themeCliTools } from './tool-call-defs-themes.js';
 * @version-history
 *   v2.2.0 -- 2026-09-24 -- aimeat_theme_save forwards `shapes`, the theme's shape values.
 *   v2.1.0 -- 2026-09-24 -- aimeat_theme_policy_set (PUT /v1/themes/policy).
 *   v2.0.0 -- 2026-09-24 -- The two-level model of 07: style and component CSS tools, restoreVersion,
 *     one request mapping shared with the connector MCP.
 *   v1.0.0 -- 2026-09-24 -- Initial (UI consolidation phase 4).
 */
import type { AimeatClient, ApiResponse } from './api-client.js';
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalBoolean, optionalRecord, optionalArray, optionalNumber } from './tool-call-helpers.js';

const enc = encodeURIComponent;

/** Only the keys the caller sent, each taken with its own coercion. */
function sent(input: JsonObject, keys: Array<[string, 'string' | 'boolean' | 'record' | 'array']>): JsonObject {
    const body: JsonObject = {};
    for (const [k, kind] of keys) {
        const v = kind === 'string' ? optionalString(input, k)
            : kind === 'boolean' ? optionalBoolean(input, k)
            : kind === 'record' ? optionalRecord(input, k)
            : optionalArray(input, k);
        if (v !== undefined) body[k] = v;
    }
    return body;
}

/** The route calls behind one theme tool. Both connector doors come through here. */
export async function themeRequests(client: AimeatClient, tool: string, input: JsonObject): Promise<ApiResponse> {
    const dryRun = optionalBoolean(input, 'dryRun') ? { dryRun: true } : {};
    switch (tool) {
        case 'aimeat_theme_list':
            return client.get('/v1/themes/all?summary=1');
        case 'aimeat_theme_get':
            return client.get(`/v1/themes/${enc(requiredString(input, 'id'))}`);
        case 'aimeat_theme_save': {
            const id = optionalString(input, 'id');
            const restore = optionalNumber(input, 'restoreVersion');
            if (restore !== undefined) {
                if (!id) return { ok: false, error: { code: 'INVALID_INPUT', message: 'restoreVersion needs the id of the theme.' } };
                return client.post(`/v1/themes/${enc(id)}/versions/${restore}/restore`, {});
            }
            const own = sent(input, [['css', 'string'], ['shapes', 'record'], ['defaultStyle', 'string'], ['offeredStyles', 'array'], ['retired', 'boolean']]);
            if (typeof own.css === 'string' && !own.css) own.css = null;
            if (id) return client.put(`/v1/themes/${enc(id)}`, { ...sent(input, [['name', 'string']]), ...own, ...dryRun });
            if (dryRun.dryRun) return { ok: false, error: { code: 'INVALID_INPUT', message: 'dryRun checks a change to a theme that exists; making a copy has nothing to check.' } };
            // A copy takes its CSS and choices from basedOn; what else is sent lands on the copy, in the same call.
            return client.post('/v1/themes', { ...sent(input, [['name', 'string'], ['basedOn', 'string']]), ...own });
        }
        case 'aimeat_theme_style_save': {
            const theme = enc(requiredString(input, 'theme'));
            const style = optionalString(input, 'style');
            const body = sent(input, [['name', 'string'], ['basedOn', 'string'], ['light', 'record'], ['dark', 'record'], ['faces', 'record'], ['onlyMode', 'string'], ['retired', 'boolean']]);
            if (body.onlyMode === '') body.onlyMode = null;
            return style
                ? client.put(`/v1/themes/${theme}/styles/${enc(style)}`, { ...body, ...dryRun })
                : client.post(`/v1/themes/${theme}/styles`, { ...body, ...dryRun });
        }
        case 'aimeat_theme_policy_set': {
            const body = sent(input, [['personalChoice', 'boolean'], ['offered', 'array'], ['default', 'string']]);
            return client.put('/v1/themes/policy', body);
        }
        case 'aimeat_theme_component_css_set':
            return client.put(`/v1/themes/${enc(requiredString(input, 'theme'))}/components/${enc(requiredString(input, 'component'))}`,
                { css: optionalString(input, 'css') || null, ...dryRun });
        default:
            return { ok: false, error: { code: 'NOT_FOUND', message: `No theme tool "${tool}".` } };
    }
}

export const themeCliTools: ConnectCliToolDefinition[] = [
    'aimeat_theme_list', 'aimeat_theme_get', 'aimeat_theme_save', 'aimeat_theme_style_save', 'aimeat_theme_component_css_set',
    'aimeat_theme_policy_set',
].map((name) => ({ name, handler: ({ client }, input) => themeRequests(client, name, input) }));
