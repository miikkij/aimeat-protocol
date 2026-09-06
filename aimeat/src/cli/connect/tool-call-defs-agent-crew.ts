/**
 * @file cli/connect/tool-call-defs-agent-crew.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The CREW half of the shell / local-call dispatch: read an agent's crew definition,
 *   ask its runtime to validate or try one, keep a draft, publish it, and seed a first one.
 *
 *   These six are a set: every one of them is about the DEFINITION an agent runs, and every one of
 *   them goes through the agent's own runtime rather than being judged by the node. Extracted from
 *   tool-call-defs-agent.ts unchanged when the run-mode and runtime-report tools pushed that file
 *   past the 800-line ceiling. A pure move: same definitions, same handlers, same comments, spread
 *   into agentTools beside the table they came from.
 * @structure agentCrewCliTools[] — the handler table, spread by tool-call-defs-agent.ts
 * @usage import { agentCrewCliTools } from './tool-call-defs-agent-crew.js';
 * @version-history
 *   v1.1.0 -- 2026-09-06 -- target_agent_name (and crew_validate/crew_seed's doc) are marked
 *     required, which is what the handlers already demanded. Declaring them optional and then
 *     throwing meant every one of these tools refused every call the published schema permitted.
 *   v1.0.0 — 2026-09-03 — Extracted from tool-call-defs-agent.ts (max-file-lines).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalNumber, optionalRecord, requiredRecord } from './tool-call-helpers.js';

export const agentCrewCliTools: ConnectCliToolDefinition[] = [
    // ── Crew definition: thin proxies onto /v1/agents/:name/crew*, the routes the Crew tab and
    // both MCP surfaces use. `target_agent_name` is the definition's agent; the call runs as the
    // registered agent the dispatcher picked.
    {
        name: 'aimeat_crew_get',
        description: "Read an agent's crew definition state: live definition, draft, kept revisions, the runtime's last load report, and whether the agent is connected.",
        input: { target_agent_name: { type: 'string', description: "The definition's agent (bare name or GAII; same owner as the caller)." } },
        handler: ({ client }, input) => client.get(`/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/crew`),
    },
    {
        name: 'aimeat_crew_validate',
        description: "Ask the agent's own runtime to validate a crew definition; the messages come back verbatim.",
        input: {
            target_agent_name: { type: 'string', required: true, description: "The definition's agent." },
            doc: { type: 'object', required: true, description: 'The whole crew definition to check.' },
        },
        handler: ({ client }, input) => client.post(`/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/crew/validate`, { doc: requiredRecord(input, 'doc') }),
    },
    {
        name: 'aimeat_crew_try',
        description: "Run a crew definition once on the agent's runtime and wait for the output (doc + prompt to start, try_id to keep waiting).",
        input: {
            target_agent_name: { type: 'string', required: true, description: "The definition's agent." },
            doc: { type: 'object', description: 'Start a trial: the definition to run once.' },
            prompt: { type: 'string', description: 'Start a trial: what the crew should do. Required with doc.' },
            try_id: { type: 'string', description: 'Continue waiting on a trial already started.' },
            wait_seconds: { type: 'number', description: 'How long to wait before handing back the try_id (default 50, max 120).' },
        },
        handler: async ({ client }, input) => {
            const path = `/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/crew/try`;
            const doc = optionalRecord(input, 'doc');
            let id = optionalString(input, 'try_id');
            if (doc) {
                const started = await client.post(path, { doc, prompt: optionalString(input, 'prompt') });
                if (!started.ok) return started;
                id = (started.data as { try_id?: string } | undefined)?.try_id;
            }
            if (!id) throw new Error('Pass doc and prompt to start a trial, or try_id to keep waiting on one.');
            const deadline = Date.now() + Math.min(120, optionalNumber(input, 'wait_seconds') ?? 50) * 1000;
            for (;;) {
                const look = await client.get(`${path}/${encodeURIComponent(id)}`);
                const status = (look.data as { status?: string } | undefined)?.status;
                if (!look.ok || status !== 'running' || Date.now() >= deadline) return look;
                await new Promise(r => setTimeout(r, 1000));
            }
        },
    },
    {
        name: 'aimeat_crew_draft',
        description: "Keep unpublished edits to an agent's crew definition, or discard the saved draft by omitting doc.",
        input: {
            target_agent_name: { type: 'string', description: "The definition's agent." },
            doc: { type: 'object', description: 'The edits to keep. Omit to discard the saved draft.' },
        },
        handler: ({ client }, input) => {
            const path = `/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/crew/draft`;
            const doc = optionalRecord(input, 'doc');
            return doc ? client.put(path, { doc }) : client.delete(path);
        },
    },
    {
        name: 'aimeat_crew_publish',
        description: "Make a crew definition live after the agent's runtime validates it, or restore a kept revision with `revision`.",
        input: {
            target_agent_name: { type: 'string', required: true, description: "The definition's agent." },
            doc: { type: 'object', description: 'The definition to make live.' },
            revision: { type: 'number', description: 'Instead of doc: the kept revision to republish.' },
        },
        handler: ({ client }, input) => {
            const base = `/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/crew`;
            const doc = optionalRecord(input, 'doc');
            if (doc) return client.post(`${base}/publish`, { doc });
            const revision = optionalNumber(input, 'revision');
            if (revision === undefined) throw new Error('Pass doc to publish a definition, or revision to restore a kept one.');
            return client.post(`${base}/restore`, { revision });
        },
    },
    {
        name: 'aimeat_crew_seed',
        description: "Give an agent its FIRST crew definition when it has no runtime yet to check one. Refused if it already has a definition.",
        input: {
            target_agent_name: { type: 'string', required: true, description: "The agent to give a first definition to." },
            doc: { type: 'object', required: true, description: 'The definition.' },
            validate_with: { type: 'string', description: 'Which connected same-owner agent should check it. Omit and any connected one is used.' },
        },
        handler: ({ client }, input) => client.post(
            `/v1/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}/crew/seed`,
            { doc: requiredRecord(input, 'doc'), validate_with: optionalString(input, 'validate_with') },
        ),
    },
];
