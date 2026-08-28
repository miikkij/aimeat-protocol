/**
 * @file crew.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The five crew-definition tools: read, validate, try, draft, publish a JSON crew
 *   definition on one of the caller's agents. One slice of CLI_FALLBACK_TOOL_DEFINITIONS;
 *   re-assembled in order by definitions.ts. The descriptions are the canonical text every surface
 *   shows (descriptionFor()).
 * @version-history
 *   v1.0.0 — 2026-08-28 — Initial (the chat path to building an agent).
 */

import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

const AGENT_NAME = { type: 'string' as const, required: true, description: "The agent whose definition this is: the bare name of one of your owner's agents, or its full GAII. An agent may name itself or a same-owner sibling." };
const DOC = { type: 'object' as const, description: 'The crew definition (crewaimeat crew_def shape): agent_name, agents[] {name, role, goal, backstory, tools[], allow_delegation}, tasks[] {id, description, expected_output, agent, context[], async}, and optionally llm_profile, temperature, process, listen_for, tags, capabilities {technical: [{name, type}], domain, languages}, skills, offers, signals, readme_md. At least one task description must contain {{ctx.prompt}}; task context may only name EARLIER task ids. Tools are the fixed menu: memory, web, article_fetch, schedule, dm, delegate, image, app_build, local_memory, exchange (or its exchange_* verbs). A definition that needs a tool of its own is a Python crew, not a definition.' };

export const crewTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_crew_get',
        description: "Read an agent's crew definition state in one call: the LIVE definition (envelope with revision, publishedAt, publishedBy, doc), the saved draft, the kept revisions, what the agent's runtime last reported loading (crews.runtime.<agent>: loadedAt, revision, ok, errors), and whether the agent is connected right now (`online`). Start here before proposing a change: edit `published.doc` (or `draft.doc`), then aimeat_crew_validate → aimeat_crew_try → aimeat_crew_publish. `online: false` means validate, try and publish cannot run until the agent's runtime is up. Never write crews.registry.<agent> with aimeat_memory_write: it would land in YOUR namespace, where the tab and the runtime do not look; publish through aimeat_crew_publish.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: { target_agent_name: AGENT_NAME },
    },
    {
        name: 'aimeat_crew_validate',
        description: "Ask the agent's OWN runtime whether a crew definition is valid (crewaimeat validate_crew_doc — the node holds no validator of its own, so what comes back is what would run). Returns {valid, errors[]} with the runtime's messages verbatim, field-anchored like `agents[0] (writer): unknown tool 'x'` or `tasks[1] (edit): agent 'nobody' does not match any defined agent`; show them to the person unchanged. Nothing is stored. Refused with AGENT_OFFLINE when the agent is not connected and CREW_RUNTIME_MISSING when it is connected but its runtime does not answer this call (it needs aimeat-crewai 0.22+ with on_invoke).",
        caller: 'agent',
        visibility: agentEverywhere,
        input: { target_agent_name: AGENT_NAME, doc: { ...DOC, required: true } },
    },
    {
        name: 'aimeat_crew_try',
        description: "Run a crew definition ONCE on the agent's own runtime with a prompt, and get the output back. A trial leaves nothing behind: no task, no memory record, no offer; the node keeps the result in memory for 15 minutes and never stores it. Pass doc + prompt to start; the call waits up to wait_seconds (default 50) and returns {status: done, result.output} or {status: running, try_id} — call again with try_id to keep waiting (a real run with a model can take minutes). Validate first: a definition the runtime refuses fails the trial with its error list. Refused with AGENT_OFFLINE when the agent is not connected.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            target_agent_name: AGENT_NAME,
            doc: { ...DOC, description: `Start a trial: ${DOC.description} Omit when continuing to wait on a try_id.` },
            prompt: { type: 'string', description: 'Start a trial: what the crew should do in this run (becomes {{ctx.prompt}}). Required with doc.' },
            try_id: { type: 'string', description: 'Continue waiting on a trial this tool already started and returned as running.' },
            wait_seconds: { type: 'number', description: 'How long this call waits for the result before handing back the try_id (default 50, max 120).' },
        },
    },
    {
        name: 'aimeat_crew_draft',
        description: "Keep unpublished edits to an agent's crew definition (crews.registry.<agent>.draft, in the agent's own namespace) so the Crew tab and a later chat session see them; or discard the saved draft by omitting doc. No validation: a draft may be half-written. Needs memory:write. Publishing consumes the draft.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: { target_agent_name: AGENT_NAME, doc: { ...DOC, description: `${DOC.description} Omit it to discard the saved draft.` } },
    },
    {
        name: 'aimeat_crew_publish',
        description: "Make a crew definition the LIVE one the agent's runtime reloads within seconds. The runtime validates it first; on problems nothing is written and the verdict comes back as CREW_INVALID with the messages verbatim. On success the definition becomes revision N+1 at crews.registry.<agent> in the AGENT'S namespace (a full copy is kept at .version.N+1, the last 10 stay restorable, the draft is consumed, and the runtime is woken with crew.def_updated). Pass `revision` instead of doc to restore a kept revision through the same gate. Needs memory:write, and the agent must be connected. This is the ONLY correct way to write crews.registry.<agent> from here.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            target_agent_name: AGENT_NAME,
            doc: { ...DOC, description: `${DOC.description} The definition to make live.` },
            revision: { type: 'number', description: 'Instead of doc: the kept revision to republish (it becomes a new revision).' },
        },
    },
];
