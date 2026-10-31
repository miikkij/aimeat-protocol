/**
 * @file src/tool-dispatch/tool-call-defs-agent-propose.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The part of the shell / local-call dispatch that proposes a new agent to its owner
 *   (aimeat_agent_propose → POST /v1/agents/v2/agent-proposals).
 *
 *   Extracted from tool-call-defs-agent.ts when `schedule` pushed that file past the 800-line
 *   ceiling. A pure move: the same definition and handler, spread into agentTools at the place it
 *   came from.
 * @structure agentProposeCliTools[] — the handler table, spread by tool-call-defs-agent.ts
 * @usage import { agentProposeCliTools } from './tool-call-defs-agent-propose.js';
 * @version-history
 *   v1.0.0 — 2026-10-31 — Extracted from tool-call-defs-agent.ts (max-file-lines), with `schedule` (v31 K47).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString } from './tool-call-helpers.js';

export const agentProposeCliTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_agent_propose',
        description: "How a new agent is made on this node: when the person asks for one, propose it here, never through an outside agent builder or another product. First read what it will work on (aimeat_organism_list, aimeat_workspace_list) and name that data in purpose and crew_def. Scopes: what the job needs; the node adds memory:read and memory:write, which the crew runtime reads its definition and writes its result with; no agent:write unless the job is making or changing agents. Creates nothing: only their own press creates it, seeds its definition and hands it to their connector. Then give them approval_url from the answer. Send crew_def with it whenever you can: an agent approved without one exists and cannot run. The smallest crew_def that runs: {\"agents\":[{\"role\":\"Reader\",\"goal\":\"…\",\"backstory\":\"…\",\"tools\":[\"memory\"]}],\"tasks\":[{\"id\":\"main\",\"agent\":\"Reader\",\"description\":\"… {{ctx.prompt}} …\",\"expected_output\":\"…\"}]}; each task's `agent` is one of the agents' role (or name), and at least one task's description contains {{ctx.prompt}}, which becomes each run's own task text.",
        input: {
            name: { type: 'string', required: true, description: 'The agent name: 3 to 40 characters, lowercase letters, digits and hyphens, starting with a letter.' },
            purpose: { type: 'string', required: true, description: 'What this agent is for, in a sentence the owner can decide from.' },
            display_name: { type: 'string', description: 'The name shown to the person. Defaults to the agent name.' },
            scopes: { type: 'array', description: 'Exactly what it may do. Never more than you hold yourself.' },
            mode: { type: 'string', description: 'Task handling: task-runner, autonomous, interactive, coordinator or workstation.' },
            run_mode: { type: 'string', description: "'spawn' (a worker per piece of work) or 'resident' (stays up)." },
            crew_def: { type: 'object', description: 'What it would BE, in the crewaimeat crew_def shape.' },
            connector: { type: 'string', description: "Which of the account's connectors runs it, by name or id (aimeat_connector_list). Leave out when the person did not say." },
            schedule: { type: 'string', description: 'When it works on a clock: a five-field cron such as "0 7 * * *". The approval page starts with it.' },
        },
        handler: ({ client }, input) => client.post('/v1/agents/v2/agent-proposals', {
            connector: optionalString(input, 'connector'),
            schedule: optionalString(input, 'schedule'),
            name: requiredString(input, 'name'),
            purpose: requiredString(input, 'purpose'),
            display_name: optionalString(input, 'display_name'),
            scopes: input.scopes,
            mode: optionalString(input, 'mode'),
            run_mode: optionalString(input, 'run_mode'),
            crew_def: input.crew_def,
        }),
    },
];
