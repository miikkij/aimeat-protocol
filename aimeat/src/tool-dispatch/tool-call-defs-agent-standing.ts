/**
 * @file src/tool-dispatch/tool-call-defs-agent-standing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The part of the shell / local-call dispatch that sets a standing fact about one of
 *   the owner's agents: whether it takes new work at all (stop, start), and where its finished
 *   work goes.
 *
 *   Extracted from tool-call-defs-agent.ts when aimeat_agent_workplace_set pushed that file past
 *   the 800-line ceiling. A pure move for stop and start: same definitions, same handlers, spread
 *   into agentTools at the place they came from.
 * @structure agentStandingCliTools[] — the handler table, spread by tool-call-defs-agent.ts
 * @usage import { agentStandingCliTools } from './tool-call-defs-agent-standing.js';
 * @version-history
 *   v1.0.0 — 2026-10-11 — Extracted from tool-call-defs-agent.ts (max-file-lines), with
 *     aimeat_agent_workplace_set → PUT or DELETE /v1/agents/:name/workplace.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString } from './tool-call-helpers.js';

export const agentStandingCliTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_agent_stop',
        description: "Stop one of the owner's agents: it starts no new work, the work it is doing finishes, scheduled runs are skipped, and what it is given waits until aimeat_agent_start. Its key and permissions stay. Never for yourself.",
        input: { target_agent_name: { type: 'string', required: true, description: 'The agent to stop.' } },
        handler: ({ client }, input) => client.post(`/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/stop`, {}),
    },
    {
        name: 'aimeat_agent_start',
        description: "Start one of the owner's agents that was stopped. Waiting tasks go through the usual start decision and waiting messages reach it; skipped scheduled runs stay skipped. Never for yourself.",
        input: { target_agent_name: { type: 'string', required: true, description: 'The agent to start.' } },
        handler: ({ client }, input) => client.post(`/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/start`, {}),
    },
    {
        name: 'aimeat_agent_workplace_set',
        description: "Say where the finished work of one of the owner's agents goes: a workspace (organism_id and workspace_id), whose members then read the result of each task it completes, or with both ids left out the agent's own memory. Nothing is copied or moved.",
        input: {
            target_agent_name: { type: 'string', required: true, description: 'The agent whose work this is about.' },
            organism_id: { type: 'string', description: 'The organism the workspace is in. Leave it out, with workspace_id, to keep the work in the agent\'s own memory.' },
            workspace_id: { type: 'string', description: 'The workspace whose members read the finished work.' },
        },
        // The address is written out in each call, so the field-reach check can read which route
        // this tool is the twin of.
        handler: ({ client }, input) => {
            const name = encodeURIComponent(requiredString(input, 'target_agent_name'));
            const organismId = optionalString(input, 'organism_id');
            const workspaceId = optionalString(input, 'workspace_id');
            if (!organismId && !workspaceId) return client.delete(`/v1/agents/${name}/workplace`);
            return client.put(`/v1/agents/${name}/workplace`, { organism_id: organismId, workspace_id: workspaceId });
        },
    },
];
