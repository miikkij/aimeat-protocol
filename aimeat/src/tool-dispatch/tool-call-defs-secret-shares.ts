/**
 * @file src/tool-dispatch/tool-call-defs-secret-shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The secret-share slice of the CLI dispatch table (CONNECT_CLI_TOOLS): what
 *   `/local/call/<tool>` and the connector MCP run for aimeat_secret_share_*. Thin calls on
 *   /v1/secret-shares (routes/vault/secret-shares.ts), so the node decides everything: the scope
 *   (secrets:share), the maker's terms, the protection rule and the pickup count.
 *
 *   The body is built from the catalog's field lists (tool-catalog/definitions/secret-shares.ts), the
 *   same lists the node MCP group uses, so the three surfaces send the same fields, and a field given
 *   is sent under the name the route reads.
 * @structure secretShareCliTools[] — registered by tool-dispatch/index.ts
 * @usage import { secretShareCliTools } from './tool-call-defs-secret-shares.js';
 * @version-history
 *   v1.0.0 -- 2026-11-14 -- Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString } from './tool-call-helpers.js';
import {
    SECRET_SHARE_CREATE_FIELDS, SECRET_SHARE_DEPOSIT_FIELDS, SECRET_SHARE_PICKUP_FIELDS,
} from '../tool-catalog/definitions/secret-shares.js';

// The paths are written out in each call, not built by a helper: scripts/inventory/field-reach.ts
// matches a CLI tool to its route by the REST call it can see in the source.
const id = (input: JsonObject) => encodeURIComponent(requiredString(input, 'id'));
/** The named fields of `input` that were given, as the route's body. */
const bodyOf = (input: JsonObject, fields: readonly string[]): JsonObject =>
    Object.fromEntries(fields.filter(k => input[k] !== undefined).map(k => [k, input[k]]));

export const secretShareCliTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_secret_share_create',
        handler: ({ client }, input) => client.post('/v1/secret-shares', bodyOf(input, SECRET_SHARE_CREATE_FIELDS)),
    },
    {
        name: 'aimeat_secret_share_list',
        handler: ({ client }) => client.get('/v1/secret-shares'),
    },
    {
        name: 'aimeat_secret_share_get',
        handler: ({ client }, input) => client.get(`/v1/secret-shares/${id(input)}`),
    },
    {
        // A signed-in depositor; this tool takes no deposit token.
        name: 'aimeat_secret_share_deposit',
        handler: ({ client }, input) => client.post(`/v1/secret-shares/${id(input)}/deposit`, bodyOf(input, SECRET_SHARE_DEPOSIT_FIELDS)),
    },
    {
        name: 'aimeat_secret_share_pickup',
        handler: ({ client }, input) => client.post(`/v1/secret-shares/${id(input)}/pickup`, bodyOf(input, SECRET_SHARE_PICKUP_FIELDS)),
    },
    {
        name: 'aimeat_secret_share_revoke',
        handler: ({ client }, input) => client.post(`/v1/secret-shares/${id(input)}/revoke`, {}),
    },
];
