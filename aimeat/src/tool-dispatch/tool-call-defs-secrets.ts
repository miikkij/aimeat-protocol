/**
 * @file tool-call-defs-secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The secrets-vault slice of the CLI dispatch table (CONNECT_CLI_TOOLS), which is what
 *   a fleet daemon actually calls through /local/call/<tool>. Three thin calls on /v1/secrets.
 *
 *   ITS OWN FILE RATHER THAN THREE MORE ENTRIES IN tool-call-defs-core.ts, which sits at 786 of the
 *   800 lines the lint rule allows.
 *
 *   THE THIRD SURFACE IS WHY THIS EXISTS AT ALL. A tool registered on the node MCP and the
 *   connector MCP does not exist here unless it is written here, and a parameter this table does
 *   not declare used to be dropped in silence — the same defect three times in one week. The
 *   dispatch refuses an undeclared parameter now (withDeclaredInputOnly in tool-call.ts) and
 *   test/unit/cli-tool-param-forwarding.test.ts invokes every handler against a recording client to
 *   prove a declared one actually leaves the process. Both apply to these three.
 * @structure secretTools[] — the shell handler table, registered by tool-call.ts
 * @usage import { secretTools } from './tool-call-defs-secrets.js';
 * @version-history
 *   v1.2.0 -- 2026-10-21 -- aimeat_secret_host_set (PATCH) and aimeat_secret_approval_withdraw (DELETE
 *     .../approvals).
 *   v1.1.0 -- 2026-10-09 -- aimeat_secret_set forwards the optional `host` (secrets audit 2026-10-09,
 *     item 10).
 *   v1.0.0 -- 2026-09-06 -- Initial. The owner's secrets vault on the fleet door.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { optionalString, requiredString } from './tool-call-helpers.js';

export const secretTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_secret_list',
        handler: ({ client }) => client.get('/v1/secrets'),
    },
    {
        name: 'aimeat_secret_set',
        // `value` is required rather than optional: an omitted value would otherwise store the word
        // undefined as somebody's API key, and nothing here could ever read it back to notice.
        // `host` is forwarded only when given, so a call without it binds at the first use as before.
        handler: ({ client }, input) => {
            const host = optionalString(input, 'host');
            return client.put(
                `/v1/secrets/${encodeURIComponent(requiredString(input, 'name'))}`,
                { value: requiredString(input, 'value'), ...(host !== undefined ? { host } : {}) },
            );
        },
    },
    {
        name: 'aimeat_secret_host_set',
        // An empty host removes the address: PATCH reads null as "remove".
        handler: ({ client }, input) => {
            if (typeof input.host !== 'string') throw new Error('Missing required string field: host');
            const host = input.host.trim();
            return client.patch(
                `/v1/secrets/${encodeURIComponent(requiredString(input, 'name'))}`,
                { host: host === '' ? null : host },
            );
        },
    },
    {
        name: 'aimeat_secret_approval_withdraw',
        handler: ({ client }, input) => {
            const q = new URLSearchParams({
                extension: requiredString(input, 'extension'),
                installer: requiredString(input, 'installer'),
                host: requiredString(input, 'host'),
            });
            return client.delete(`/v1/secrets/${encodeURIComponent(requiredString(input, 'name'))}/approvals?${q.toString()}`);
        },
    },
    {
        name: 'aimeat_secret_delete',
        handler: ({ client }, input) => client.delete(
            `/v1/secrets/${encodeURIComponent(requiredString(input, 'name'))}`,
        ),
    },
];
