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
 *   v1.0.0 -- 2026-09-06 -- Initial. The owner's secrets vault on the fleet door.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString } from './tool-call-helpers.js';

export const secretTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_secret_list',
        handler: ({ client }) => client.get('/v1/secrets'),
    },
    {
        name: 'aimeat_secret_set',
        // `value` is required rather than optional: an omitted value would otherwise store the word
        // undefined as somebody's API key, and nothing here could ever read it back to notice.
        handler: ({ client }, input) => client.put(
            `/v1/secrets/${encodeURIComponent(requiredString(input, 'name'))}`,
            { value: requiredString(input, 'value') },
        ),
    },
    {
        name: 'aimeat_secret_delete',
        handler: ({ client }, input) => client.delete(
            `/v1/secrets/${encodeURIComponent(requiredString(input, 'name'))}`,
        ),
    },
];
