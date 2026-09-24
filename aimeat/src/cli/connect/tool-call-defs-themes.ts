/**
 * @file cli/connect/tool-call-defs-themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The third surface of Themes & Styles (`aimeat connect call` and POST /local/call):
 *   aimeat_theme_list, aimeat_theme_get and aimeat_theme_save, each forwarding every declared
 *   parameter to the /v1/themes routes. Their own file because tool-call-defs-apps.ts and
 *   tool-call-defs-core.ts sit under the 800-line ceiling.
 * @structure themeCliTools[] -- the shell handler table, registered by tool-call.ts
 * @usage import { themeCliTools } from './tool-call-defs-themes.js';
 * @version-history
 *   v1.0.0 -- 2026-09-24 -- Initial (UI consolidation phase 4).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalBoolean, optionalRecord } from './tool-call-helpers.js';

export const themeCliTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_theme_list',
        handler: ({ client }) => client.get('/v1/themes/all?summary=1'),
    },
    {
        name: 'aimeat_theme_get',
        handler: ({ client }, input) => client.get(`/v1/themes/${encodeURIComponent(requiredString(input, 'id'))}`),
    },
    {
        name: 'aimeat_theme_save',
        handler: ({ client }, input) => {
            const id = optionalString(input, 'id');
            const css = optionalString(input, 'css');
            const onlyMode = optionalString(input, 'onlyMode');
            const body = {
                ...(optionalString(input, 'name') !== undefined ? { name: optionalString(input, 'name') } : {}),
                ...(optionalString(input, 'basedOn') !== undefined ? { basedOn: optionalString(input, 'basedOn') } : {}),
                ...(optionalRecord(input, 'light') ? { light: optionalRecord(input, 'light') } : {}),
                ...(optionalRecord(input, 'dark') ? { dark: optionalRecord(input, 'dark') } : {}),
                ...(optionalRecord(input, 'faces') ? { faces: optionalRecord(input, 'faces') } : {}),
                ...(css !== undefined ? { css: css || null } : {}),
                ...(onlyMode !== undefined ? { onlyMode: onlyMode || null } : {}),
                ...(optionalBoolean(input, 'retired') !== undefined ? { retired: optionalBoolean(input, 'retired') } : {}),
            };
            if (optionalBoolean(input, 'dryRun')) return client.post('/v1/themes/check', { ...body, ...(id ? { id } : {}) });
            return id ? client.put(`/v1/themes/${encodeURIComponent(id)}`, body) : client.post('/v1/themes', body);
        },
    },
];
