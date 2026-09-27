/**
 * @file tool-call-defs-skills.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The skills-registry slice of the CLI dispatch table (CONNECT_CLI_TOOLS): publish,
 *   list, get, link, unlink and update, each a thin call on /v1/skills or /v1/agents/:name/skills.
 *   Moved out of tool-call-defs-core.ts unchanged when that file crossed 800 lines.
 * @usage import { skillTools } from './tool-call-defs-skills.js';
 * @version-history
 *   v1.0.0 -- 2026-09-03 -- Extracted from tool-call-defs-core.ts (pure move).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalBoolean } from './tool-call-helpers.js';

export const skillTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_skill_publish',
        handler: ({ client }, input) => client.post('/v1/skills', {
            skill_md: requiredString(input, 'skill_md'),
            files: input.files,
            scope: optionalString(input, 'scope'),
            visibility: optionalString(input, 'visibility'),
            organism: optionalString(input, 'organism_id'),
            ws: optionalString(input, 'workspace_id'),
        }),
    },
    {
        name: 'aimeat_skill_list',
        handler: ({ client, agentPath }, input) => {
            const view = optionalString(input, 'view') ?? 'library';
            if (view === 'linked') return client.get(`/v1/agents/${agentPath}/skills/links`);
            // `view=workspace` is published in the catalog and was not implemented on either
            // connector door: it fell through to the library listing, so asking for one workspace's
            // skills answered with the whole node's and looked like the workspace had none. The
            // route spells its parameters `organism` and `ws`, not organism_id / workspace_id.
            if (view === 'workspace') {
                return client.get(`/v1/skills${query({
                    scope: 'workspace',
                    organism: optionalString(input, 'organism_id'),
                    ws: optionalString(input, 'workspace_id'),
                    binding: optionalString(input, 'binding'),
                })}`);
            }
            return client.get(`/v1/skills${query({
                scope: view === 'mine' ? 'user' : 'library',
                binding: optionalString(input, 'binding'),
            })}`);
        },
    },
    {
        name: 'aimeat_skill_get',
        handler: ({ client }, input) => {
            const ref = optionalString(input, 'ref');
            // Through query() like the rest of this file, rather than four hand-built strings and
            // a `.replace('&', '')` to undo the leading separator on the one branch where the flag
            // came first. That worked only because the fragment happened to contain exactly one
            // `&`, which is a fact about today's flag rather than a rule (CodeQL
            // js/incomplete-sanitization 1603). query() decides the `?` and the separators.
            const manifestOnly = optionalBoolean(input, 'manifest_only') ? true : undefined;
            if (ref) {
                const node = ref.match(/^node:([a-z0-9-]+)$/);
                if (node) return client.get(`/v1/skills/${encodeURIComponent(node[1])}${query({ scope: 'node', manifest_only: manifestOnly })}`);
                const user = ref.match(/^user:([a-z0-9_-]+)\/([a-z0-9-]+)$/);
                if (user) return client.get(`/v1/skills/${encodeURIComponent(user[2])}${query({ scope: 'user', owner: user[1], manifest_only: manifestOnly })}`);
                const ws = ref.match(/^ws:([A-Za-z0-9-]+)\/([A-Za-z0-9-]+)\/([a-z0-9-]+)$/);
                if (ws) return client.get(`/v1/skills/${encodeURIComponent(ws[3])}${query({ scope: 'workspace', organism: ws[1], ws: ws[2], manifest_only: manifestOnly })}`);
                throw new Error(`Not a valid skill ref: ${ref}`);
            }
            return client.get(`/v1/skills/${encodeURIComponent(requiredString(input, 'name'))}${query({ manifest_only: manifestOnly })}`);
        },
    },
    {
        name: 'aimeat_skill_link',
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${agentPath}/skills`, {
            ref: requiredString(input, 'ref'),
        }),
    },
    {
        name: 'aimeat_skill_unlink',
        handler: ({ client, agentPath }, input) => client.delete(`/v1/agents/${agentPath}/skills?ref=${encodeURIComponent(requiredString(input, 'ref'))}`),
    },
    {
        name: 'aimeat_skill_update',
        handler: ({ client }, input) => client.patch(
            `/v1/skills/${encodeURIComponent(requiredString(input, 'name'))}?scope=${optionalString(input, 'scope') ?? 'user'}`,
            { visibility: requiredString(input, 'visibility') },
        ),
    },
];
