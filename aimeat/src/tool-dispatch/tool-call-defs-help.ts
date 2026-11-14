/**
 * @file src/tool-dispatch/tool-call-defs-help.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Ask someone who knows slice of the CLI dispatch table (CONNECT_CLI_TOOLS): what
 *   `/local/call/<tool>` and the connector MCP run for aimeat_help_*. Thin calls on /v1/help and
 *   /v1/admin/help (routes/help/), so the node decides everything: the scopes, the owner's choices,
 *   the AI level, the limits and the morsels.
 *
 *   The body is built from the catalog's field lists (tool-catalog/definitions/help.ts), the same lists
 *   the node MCP group uses, so the three surfaces send the same fields.
 * @structure helpCliTools[] — registered by tool-dispatch/index.ts
 * @usage import { helpCliTools } from './tool-call-defs-help.js';
 * @version-history
 *   v1.0.0 -- 2026-11-14 -- Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString } from './tool-call-helpers.js';
import {
    HELP_PROFILE_FIELDS, HELP_FIND_FIELDS, HELP_ASK_FIELDS, HELP_RESPOND_FIELDS, HELP_CLOSE_FIELDS, HELP_REPORT_WRITE_FIELDS,
} from '../tool-catalog/definitions/help.js';

// The paths are written out in each call, not built by a helper: scripts/inventory/field-reach.ts
// matches a CLI tool to its route by the REST call it can see in the source.
const qid = (input: JsonObject) => encodeURIComponent(requiredString(input, 'question_id'));
const rid = (input: JsonObject) => encodeURIComponent(requiredString(input, 'id'));
/** The named fields of `input` that were given, as the route's body. */
const bodyOf = (input: JsonObject, fields: readonly string[]): JsonObject =>
    Object.fromEntries(fields.filter(k => input[k] !== undefined).map(k => [k, input[k]]));

export const helpCliTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_help_find',
        handler: ({ client }, input) => client.post('/v1/help/find', bodyOf(input, HELP_FIND_FIELDS)),
    },
    {
        name: 'aimeat_help_ask',
        handler: ({ client }, input) => client.post('/v1/help/questions', bodyOf(input, HELP_ASK_FIELDS)),
    },
    {
        name: 'aimeat_help_inbox',
        handler: ({ client }, input) => client.get(`/v1/help/inbox${input.include_closed === true ? '?include_closed=true' : ''}`),
    },
    {
        name: 'aimeat_help_respond',
        handler: ({ client }, input) => client.post(`/v1/help/questions/${qid(input)}/respond`, bodyOf(input, HELP_RESPOND_FIELDS)),
    },
    {
        name: 'aimeat_help_close',
        handler: ({ client }, input) => client.post(`/v1/help/questions/${qid(input)}/close`, bodyOf(input, HELP_CLOSE_FIELDS)),
    },
    {
        name: 'aimeat_help_profile_set',
        handler: ({ client }, input) => client.put('/v1/help/me', bodyOf(input, HELP_PROFILE_FIELDS)),
    },
    {
        name: 'aimeat_help_report_data',
        handler: ({ client }, input) => {
            const q = new URLSearchParams();
            if (typeof input.id === 'string') q.set('id', input.id);
            if (typeof input.make === 'string') q.set('make', input.make);
            const qs = q.toString();
            return client.get(`/v1/admin/help/reports${qs ? `?${qs}` : ''}`);
        },
    },
    {
        name: 'aimeat_help_report_write',
        handler: ({ client }, input) => client.post(`/v1/admin/help/reports/${rid(input)}`, bodyOf(input, HELP_REPORT_WRITE_FIELDS)),
    },
];
