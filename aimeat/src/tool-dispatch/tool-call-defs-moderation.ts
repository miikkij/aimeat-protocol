/**
 * @file src/tool-dispatch/tool-call-defs-moderation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The moderation review tools for the shell / local-call dispatch and the connector MCP,
 *   over GET and PUT /v1/flags (routes/flags.ts) and POST /v1/flags/:flagId/appeal, GET /v1/appeals
 *   and POST /v1/appeals/:id/review (routes/appeals.ts). The routes decide who may act; this file
 *   only forwards.
 * @structure moderationCliTools[]
 * @usage import { moderationCliTools } from './tool-call-defs-moderation.js';
 * @version-history
 *   v1.0.0 -- 2026-11-19 -- Initial: aimeat_admin_flags, aimeat_admin_flag_review, aimeat_flag_appeal,
 *     aimeat_appeals and aimeat_appeal_review.
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalNumber, query } from './tool-call-helpers.js';

export const moderationCliTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/flags?status=&targetType=&page=&per_page=
        name: 'aimeat_admin_flags',
        handler: ({ client }, input) => client.get(`/v1/flags${query({
            status: optionalString(input, 'status'), targetType: optionalString(input, 'target_type'),
            page: optionalNumber(input, 'page'), per_page: optionalNumber(input, 'per_page'),
        })}`),
    },
    {
        // → PUT /v1/flags/:id
        name: 'aimeat_admin_flag_review',
        handler: ({ client }, input) => client.put(`/v1/flags/${encodeURIComponent(requiredString(input, 'flag_id'))}`,
            { status: requiredString(input, 'status') }),
    },
    {
        // → POST /v1/flags/:flagId/appeal
        name: 'aimeat_flag_appeal',
        handler: ({ client }, input) => client.post(`/v1/flags/${encodeURIComponent(requiredString(input, 'flag_id'))}/appeal`,
            { reason: requiredString(input, 'reason') }),
    },
    {
        // → GET /v1/appeals?status=&page=&per_page=
        name: 'aimeat_appeals',
        handler: ({ client }, input) => client.get(`/v1/appeals${query({
            status: optionalString(input, 'status'), page: optionalNumber(input, 'page'), per_page: optionalNumber(input, 'per_page'),
        })}`),
    },
    {
        // → POST /v1/appeals/:id/review
        name: 'aimeat_appeal_review',
        handler: ({ client }, input) => {
            const body: JsonObject = { decision: requiredString(input, 'decision') };
            const note = optionalString(input, 'note'); if (note !== undefined) body.note = note;
            return client.post(`/v1/appeals/${encodeURIComponent(requiredString(input, 'appeal_id'))}/review`, body);
        },
    },
];
