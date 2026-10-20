/**
 * @file src/tool-dispatch/tool-call-defs-extensions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The CLI dispatch definitions for the server-side extension tools: the third surface
 *   behind `/local/call/<tool>`, which is what a fleet daemon calls. Each entry is a thin proxy over
 *   the REST route its node MCP twin uses, and decides nothing — the scope check, the validation and
 *   the provenance stay in the route (.claude/rules/tool-surfaces.md).
 *
 *   PURE EXTRACTION from tool-call-defs-apps.ts on 2026-10-20, when that file stood at 792 lines and
 *   the next extension tool would have pushed it over the 800-line ceiling. The eight entries moved
 *   unchanged, comments and all; only `aimeat_extension_unattended_reader` is new. The group was
 *   already contiguous there, which is why it is the one that moved.
 * @structure extensionTools
 * @usage import { extensionTools } from './tool-call-defs-extensions.js'; // spread in index.ts
 * @version-history
 *   v1.0.0 -- 2026-10-20 -- Extracted from tool-call-defs-apps.ts (max-file-lines), plus
 *     aimeat_extension_unattended_reader (Jouni, 2026-10-20, on secaudit 2026-10
 *     extension-system-run:files-read-as-owner-ghii).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalBoolean, optionalRecord } from './tool-call-helpers.js';
import { installExtensionOverHttp, extensionDetailPath } from './extension-install.js';

export const extensionTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_extension_list',
        description: 'List installed extensions.',
        input: {},
        handler: ({ client }) => client.get('/v1/extensions'),
    },
    {
        name: 'aimeat_extension_invoke',
        description: 'Invoke an extension action.',
        input: {
            extension_name: { type: 'string', description: 'Extension name. (`name` is accepted as the older spelling this tool used.)' },
            name: { type: 'string', description: 'Older spelling of extension_name.' },
            action_id: { type: 'string', required: true, description: 'Action identifier.' },
            input: { type: 'object', description: 'Input parameters.' },
            instance_id: { type: 'string', description: 'Which installed instance to invoke, when the extension has more than one.' },
        },
        // AN INSTANCE IS A PATH SEGMENT, NOT A QUERY PARAMETER. This appended `?instance_id=` to the
        // extension-scoped route, which reads no query at all — so a fleet agent invoking a
        // two-instance extension ran against the SHARED `ext:{name}` namespace, with the wrong
        // config and the wrong wallet scope, and got ok back. The instance-scoped route has existed
        // beside it throughout, and the connector-MCP door has always used it. Review item 6.3.
        handler: ({ client }, input) => {
            const ext = encodeURIComponent(optionalString(input, 'extension_name') ?? requiredString(input, 'name'));
            const actionId = encodeURIComponent(requiredString(input, 'action_id'));
            const instanceId = optionalString(input, 'instance_id');
            return client.post(
                instanceId ? `/v1/ext/${ext}/${encodeURIComponent(instanceId)}/${actionId}` : `/v1/ext/${ext}/${actionId}`,
                optionalRecord(input, 'input') ?? {},
            );
        },
    },
    {
        // The catalog's input is the contract (manifest YAML, scripts, update, activate). This entry
        // declared its own `name` and an OBJECT manifest, and JSON-parsed the YAML a caller sends, so
        // no real manifest ever left the process; and it posted update/activate to POST
        // /v1/extensions, which reads neither. The logic is installExtensionOverHttp(), shared with the
        // connector's MCP door.
        name: 'aimeat_extension_install',
        handler: ({ client }, input) => installExtensionOverHttp(client, {
            manifest: optionalString(input, 'manifest'),
            scripts: optionalRecord(input, 'scripts'),
            update: optionalBoolean(input, 'update'),
            activate: optionalBoolean(input, 'activate'),
        }),
    },
    {
        name: 'aimeat_extension_activate',
        description: 'Activate an installed extension.',
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
        handler: ({ client }, input) => client.post(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}/activate`),
    },
    {
        name: 'aimeat_extension_deactivate',
        description: 'Deactivate an extension.',
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
        handler: ({ client }, input) => client.post(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}/deactivate`),
    },
    {
        name: 'aimeat_extension_config_set',
        description: 'Change config values of an installed extension in place.',
        input: {
            name: { type: 'string', required: true, description: 'Extension name.' },
            config: { type: 'object', required: true, description: 'The fields to change: { "<field>": value }.' },
        },
        handler: ({ client }, input) => client.patch(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}/config`, {
            config: optionalRecord(input, 'config'),
        }),
    },
    {
        // READ ONLY, and there is no set entry beside it on purpose: the write takes
        // requireOwnerPrincipal, which no connector session holds. The answer carries changed_at_url
        // so the agent can hand the person the address instead of a refusal
        // (routes/extensions/unattended-reader.ts).
        name: 'aimeat_extension_unattended_reader',
        description: 'What an installed extension may read when it runs with nobody present.',
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
        handler: ({ client }, input) => client.get(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}/unattended-reader`),
    },
    {
        name: 'aimeat_extension_delete',
        description: 'Uninstall an extension.',
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
        handler: ({ client }, input) => client.delete(`/v1/extensions/${encodeURIComponent(requiredString(input, 'name'))}`),
    },
    {
        // include_source reads ?full=true, which the route answers with the scripts only to the
        // installer's own sessions holding ext:write, and refuses to anyone else.
        name: 'aimeat_extension_get',
        handler: ({ client }, input) => client.get(extensionDetailPath(requiredString(input, 'name'), optionalBoolean(input, 'include_source'))),
    },
];
