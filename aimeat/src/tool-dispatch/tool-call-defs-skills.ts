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
 *   v1.1.0 -- 2026-10-06 -- skill_list, skill_link and skill_unlink act on the agent named in
 *     agent_name, as the node's MCP does; they acted on the calling agent whatever was asked.
 *     skill_list's binding overrides the view, as the catalog says. skill_publish without skill_md
 *     and skill_get without ref or name say what is missing (secaudit 2026-10 follow-up, Part B).
 *   v1.2.0 -- 2026-10-08 -- skill_publish forwards ai_provenance and ai_provenance_id, which
 *     POST /v1/skills records (aiprov E12).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalBoolean } from './tool-call-helpers.js';

/** The agent a link tool acts on: the same-owner agent named in agent_name, else the caller. The
 *  route checks that the name belongs to the caller's owner. */
function targetAgent(agentPath: string, input: Record<string, unknown>): string {
    const named = optionalString(input, 'agent_name');
    return named ? encodeURIComponent(named) : agentPath;
}

export const skillTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_skill_publish',
        handler: ({ client }, input) => {
            // Without skill_md the node's MCP hands out an upload URL for a skill ZIP. No route mints
            // one, so over HTTP the content has to come inline.
            if (!optionalString(input, 'skill_md')) {
                return Promise.resolve({ ok: false as const, error: { code: 'INVALID_INPUT', message: 'skill_md is required on the connector and the shell: pass the SKILL.md content inline. Uploading a skill ZIP needs the node MCP endpoint.' } });
            }
            return client.post('/v1/skills', {
                skill_md: requiredString(input, 'skill_md'),
                files: input.files,
                scope: optionalString(input, 'scope'),
                visibility: optionalString(input, 'visibility'),
                organism: optionalString(input, 'organism_id'),
                ws: optionalString(input, 'workspace_id'),
                // POST /v1/skills records how SKILL.md was written (aiprov E12).
                ...(input.ai_provenance && typeof input.ai_provenance === 'object' ? { ai_provenance: input.ai_provenance } : {}),
                ...(optionalString(input, 'ai_provenance_id') ? { ai_provenance_id: optionalString(input, 'ai_provenance_id') } : {}),
            });
        },
    },
    {
        name: 'aimeat_skill_list',
        handler: ({ client, agentPath }, input) => {
            const view = optionalString(input, 'view') ?? 'library';
            const binding = optionalString(input, 'binding');
            // The binding filter overrides the view on the node's MCP; GET /v1/skills answers it first.
            if (binding) return client.get(`/v1/skills${query({ binding })}`);
            if (view === 'linked') return client.get(`/v1/agents/${targetAgent(agentPath, input)}/skills/links`);
            // `view=workspace` is published in the catalog and was not implemented on either
            // connector door: it fell through to the library listing, so asking for one workspace's
            // skills answered with the whole node's and looked like the workspace had none. The
            // route spells its parameters `organism` and `ws`, not organism_id / workspace_id.
            if (view === 'workspace') {
                return client.get(`/v1/skills${query({
                    scope: 'workspace',
                    organism: optionalString(input, 'organism_id'),
                    ws: optionalString(input, 'workspace_id'),
                })}`);
            }
            return client.get(`/v1/skills${query({
                scope: view === 'mine' ? 'user' : 'library',
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
            const name = optionalString(input, 'name');
            if (!name) throw new Error('Provide ref or name');
            return client.get(`/v1/skills/${encodeURIComponent(name)}${query({ manifest_only: manifestOnly })}`);
        },
    },
    {
        name: 'aimeat_skill_link',
        handler: ({ client, agentPath }, input) => client.post(`/v1/agents/${targetAgent(agentPath, input)}/skills`, {
            ref: requiredString(input, 'ref'),
        }),
    },
    {
        name: 'aimeat_skill_unlink',
        handler: ({ client, agentPath }, input) => client.delete(`/v1/agents/${targetAgent(agentPath, input)}/skills?ref=${encodeURIComponent(requiredString(input, 'ref'))}`),
    },
    {
        name: 'aimeat_skill_update',
        handler: ({ client }, input) => client.patch(
            `/v1/skills/${encodeURIComponent(requiredString(input, 'name'))}?scope=${optionalString(input, 'scope') ?? 'user'}`,
            { visibility: requiredString(input, 'visibility') },
        ),
    },
];
