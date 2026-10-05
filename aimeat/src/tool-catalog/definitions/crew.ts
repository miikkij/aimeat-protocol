/**
 * @file crew.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The crew-definition tools: read, validate, try, draft, publish and seed a JSON crew
 *   definition, plus what the runtime offers (menu) and which model it thinks with (llm_set).
 *   definition on one of the caller's agents. One slice of CLI_FALLBACK_TOOL_DEFINITIONS;
 *   re-assembled in order by definitions.ts. The descriptions are the canonical text every surface
 *   shows (descriptionFor()).
 * @version-history
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   v1.3.0 — 2026-10-02 — aimeat_crew_llm_set: the {kind:'node', role?} choice, and the rules a
 *     `model` choice is refused on (UNSAFE_CHOICE).
 *   v1.2.0 — 2026-09-09 — aimeat_crew_menu and aimeat_crew_llm_set: the runtime answers for its
 *     own tool list, and the owner's model choice is a record rather than a file on one machine.
 *   v1.1.0 — 2026-09-09 — app_tools joins the menu text, which had named crew_registry but not it.
 *   v1.0.0 — 2026-08-28 — Initial (the chat path to building an agent).
 */

import { MAX_WAIT_SECONDS } from '../input-schemas.js';
import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

const AGENT_NAME = { type: 'string' as const, required: true as const, description: "The agent whose definition this is: the bare name of one of your owner's agents, or its full GAII. An agent may name itself or a same-owner sibling." };
const DOC = { type: 'object' as const, description: 'The crew definition (crewaimeat crew_def shape): agent_name, agents[] {name, role, goal, backstory, tools[], allow_delegation}, tasks[] {id, description, expected_output, agent, context[], async}, and optionally llm_profile, temperature, process, listen_for, tags, capabilities {technical: [{name, type}], domain, languages}, skills, offers, signals, readme_md. At least one task description must contain {{ctx.prompt}}; task context may only name EARLIER task ids. Tools come from the runtime\'s own menu — memory, web, article_fetch, schedule, dm, delegate, image, app_build, local_memory, app_tools, crew_registry, exchange (and exchange_* verbs) — which the runtime owns and adds to, so this list can be behind it; the runtime refuses a tool that does not exist. A definition that needs a tool of its own is a Python crew, not a definition. `listen_for` says which wake starts the crew (tasks, messages, records, dms) and defaults to ["tasks"], which is wrong for any agent whose work arrives as a message.' };

export const crewTools = [
    {
        name: 'aimeat_crew_get',
        description: "Read an agent's crew definition state in one call: the LIVE definition (envelope with revision, publishedAt, publishedBy, doc), the saved draft, the kept revisions, what the agent's runtime last reported loading (crews.runtime.<agent>: loadedAt, revision, ok, errors), and whether the agent is connected right now (`online`). Start here before proposing a change: edit `published.doc` (or `draft.doc`), then aimeat_crew_validate → aimeat_crew_try → aimeat_crew_publish. `online: false` means validate, try and publish cannot run until the agent's runtime is up. Never write crews.registry.<agent> with aimeat_memory_write: it would land in YOUR namespace, where the tab and the runtime do not look; publish through aimeat_crew_publish.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Crew Definition', readOnlyHint: true },
        // aimeat_agent_tags_set and aimeat_agent_runtime_report left this list on 2026-10-02 for
        // SCOPE_EXEMPT_TOOLS: an agent's own record needs no word, a sibling's needs agent:write, and the
        // handler checks which (auth/self-or-scope.ts).
        // A crew definition is a memory record in the agent's namespace: reading it is memory:read,
        // and every step toward changing it (validate, try, draft, publish) is memory:write, the scope
        // the REST doors gate the writes on. Validate and try change nothing, but they are only ever
        // steps of a publish, and an agent that may not publish has no business driving a sibling's
        // runtime through them.
        scope: 'memory:read',
        surfaces: ['agent', 'service', 'admin'],
        input: { target_agent_name: AGENT_NAME },
    },
    {
        name: 'aimeat_crew_validate',
        description: "Ask the agent's OWN runtime whether a crew definition is valid (crewaimeat validate_crew_doc — the node holds no validator of its own, so what comes back is what would run). Returns {valid, errors[]} with the runtime's messages verbatim, field-anchored like `agents[0] (writer): unknown tool 'x'` or `tasks[1] (edit): agent 'nobody' does not match any defined agent`; show them to the person unchanged. Nothing is stored. Refused with AGENT_OFFLINE when the agent is not connected and CREW_RUNTIME_MISSING when it is connected but its runtime does not answer this call (it needs aimeat-crewai 0.22+ with on_invoke).",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Validate Crew Definition', readOnlyHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent', 'service', 'admin'],
        input: { target_agent_name: AGENT_NAME, doc: { ...DOC, required: true } },
    },
    {
        name: 'aimeat_crew_try',
        description: "Run a crew definition ONCE on the agent's own runtime with a prompt, and get the output back. A trial leaves nothing behind: no task, no memory record, no offer; the node keeps the result in memory for 15 minutes and never stores it. Pass doc + prompt to start; the call waits up to wait_seconds (default 50) and returns {status: done, result.output} or {status: running, try_id} — call again with try_id to keep waiting (a real run with a model can take minutes). Validate first: a definition the runtime refuses fails the trial with its error list. Refused with AGENT_OFFLINE when the agent is not connected.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Try Crew Definition Once', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent', 'service', 'admin'],
        input: {
            target_agent_name: AGENT_NAME,
            doc: { ...DOC, description: `Start a trial: ${DOC.description} Omit when continuing to wait on a try_id.` },
            prompt: { type: 'string', description: 'Start a trial: what the crew should do in this run (becomes {{ctx.prompt}}). Required with doc.', zod: z.string().min(1).max(20_000) },
            try_id: { type: 'string', description: 'Continue waiting on a trial this tool already started and returned as running.' },
            wait_seconds: { type: 'number', description: 'How long this call waits for the result before handing back the try_id (default 50, max 120).', zod: z.number().int().min(0).max(MAX_WAIT_SECONDS) },
        },
    },
    {
        name: 'aimeat_crew_draft',
        description: "Keep unpublished edits to an agent's crew definition (crews.registry.<agent>.draft, in the agent's own namespace) so the Crew tab and a later chat session see them; or discard the saved draft by omitting doc. No validation: a draft may be half-written. Needs memory:write. Publishing consumes the draft.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Save or Discard Crew Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent', 'service', 'admin'],
        input: { target_agent_name: AGENT_NAME, doc: { ...DOC, description: `${DOC.description} Omit it to discard the saved draft.` } },
    },
    {
        name: 'aimeat_crew_publish',
        description: "Make a crew definition the LIVE one the agent's runtime reloads within seconds. The runtime validates it first; on problems nothing is written and the verdict comes back as CREW_INVALID with the messages verbatim. On success the definition becomes revision N+1 at crews.registry.<agent> in the AGENT'S namespace (a full copy is kept at .version.N+1, the last 10 stay restorable, the draft is consumed, and the runtime is woken with crew.def_updated). Pass `revision` instead of doc to restore a kept revision through the same gate. Needs memory:write, and the agent must be connected. This is the ONLY correct way to write crews.registry.<agent> from here.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Publish Crew Definition', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent', 'service', 'admin'],
        input: {
            target_agent_name: AGENT_NAME,
            doc: { ...DOC, description: `${DOC.description} The definition to make live.` },
            revision: { type: 'number', description: 'Instead of doc: the kept revision to republish (it becomes a new revision).', zod: z.number().int().positive() },
        },
    },
    {
        name: 'aimeat_crew_menu',
        description: "What an agent's RUNTIME actually offers, asked rather than guessed: the tool names its interpreter resolves, the model profiles the machine it runs on can reach, the models behind them, and which model is chosen for this agent right now. Read this before writing a definition's `tools` — the fixed list in aimeat_crew_publish's own description is this node's copy and has been two tools behind the runtime. `source` says who answered: 'runtime' (the agent, over the tunnel), 'catalog' (it is offline, this is what it published at its last start), 'none' (nobody has ever said). `choice.scope` is 'agent' when this agent has its own and 'default' when it is the owner's, and null means neither, so the machine's own configuration decides.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: "Read the Runtime's Menu", readOnlyHint: true, openWorldHint: false },
        // The menu is a read of what the runtime offers; the choice is a record in the owner's
        // namespace, so it takes the same word every other record there takes.
        scope: 'memory:read',
        surfaces: ['agent', 'service', 'admin'],
        input: { target_agent_name: AGENT_NAME },
    },
    {
        name: 'aimeat_crew_llm_set',
        description: "Choose which model an agent thinks with, or clear the choice. Pass `target_agent_name` for one agent, or omit it to set the owner's DEFAULT for every agent they have. `choice` is {kind:'node', role?} to think through this node (the crew sends its model calls to the node's /v1/llm with the agent's own token, and the node picks the model and the key: the agent's own key, then the owner's, then the node's from the owner's allowance; `role` names one of the owner's AI roles; the agent needs ai:use), {kind:'profile', profile:'<name>'} naming a profile from aimeat_crew_menu, or {kind:'model', label, provider} pinning one model; pass null to clear and fall back. Precedence, strongest first: a pin made on the machine itself, this agent's own choice, the machine's `crews` map, the crew definition's own `llm_profile`, the owner's default, the machine's default. A `provider` may NAME the environment variable holding the key (api_key_env) and is refused if it carries a key: the credential stays on the machine that runs the agent. api_key_env must be a provider key variable (a name ending in _API_KEY, not starting with AIMEAT_), and every address in the provider must be public https; anything else is refused with UNSAFE_CHOICE. Needs memory:write; the choice is a record in the owner's own namespace (crews.llm.<agent>), so their own tools can read it.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: "Choose an Agent's Model", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent', 'service', 'admin'],
        input: {
            target_agent_name: { ...AGENT_NAME, required: false, description: `${AGENT_NAME.description} Omit it to set the owner's default for every agent.` },
            choice: { type: 'object', description: "The choice: {kind:'node', role?}, {kind:'profile', profile} or {kind:'model', label, provider}. Omit or pass null to clear it.", zod: z.record(z.string(), z.unknown()).nullish() },
        },
    },
    {
        name: 'aimeat_crew_seed',
        description: "Give an agent its FIRST crew definition when it has no runtime yet to check one. Use this after creating an agent (the basic-agents button, or your own device-authorized registration): the agent has nothing to load, so aimeat_crew_publish would answer AGENT_OFFLINE forever and the agent could never be given anything to be. REFUSED if the agent already has a definition — change that one with aimeat_crew_publish, where the agent's own runtime has the say. Validation still happens on a REAL runtime: the agent itself if it is connected, otherwise the same-owner agent you name in validate_with, otherwise any connected agent of the owner. Whoever it was is recorded on the published definition as validatedBy, so nobody later reads a sibling's verdict as the agent's own. Needs memory:write. Refused with NO_VALIDATOR when nothing of the owner's is connected at all.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Seed a First Crew Definition', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['agent', 'service', 'admin'],
        input: {
            target_agent_name: AGENT_NAME,
            doc: { ...DOC, required: true, description: `${DOC.description} The FIRST definition for this agent.` },
            validate_with: { type: 'string', description: 'Which connected same-owner agent should check it. Omit and any connected one is used.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
