/**
 * @file agent-crew.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Public MCP tools for a JSON crew definition on one of the caller's agents: read,
 *   validate, try, draft, publish. This is the chat path to building an agent: a person's own AI
 *   reads the definition, proposes a change, has the agent's runtime validate it, runs it once,
 *   and publishes — the whole loop the Crew tab offers, without a browser or this repo. Every tool
 *   calls services/crew-ops.ts, the same code the HTTP routes call, so the two cannot drift.
 *   Nothing here writes memory itself: a chat session is an agent principal with its own name,
 *   and a plain memory write of `crews.registry.<agent>` would land under that name, invisible to
 *   the tab and the runtime (memory-write.ts refuses that write now, and points here).
 * @structure
 *   - registerAgentCrewTools() -- aimeat_crew_get, aimeat_crew_validate, aimeat_crew_try,
 *     aimeat_crew_draft, aimeat_crew_publish
 * @usage registerAgentCrewTools(mcp, storage, config, () => agentGaii, scopes);
 * @version-history
 *   2026-10-11 — aimeat_crew_publish and aimeat_crew_seed answer with `warnings`.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 -- 2026-08-28 -- Initial: the five tools over services/crew-ops.ts.
 *   v1.0.2 -- 2026-10-02 -- aimeat_crew_llm_set's choice names the {kind:'node', role?} shape.
 *   v1.0.1 -- 2026-09-26 -- The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import {
    crewState, crewValidate, crewTryStart, crewTryWait, crewDraftSave, crewDraftDiscard, crewPublish, crewRestore, crewSeed, crewData,
    resolveCrewAgent, type CrewCaller, type CrewRefusal,
} from '../services/crew-ops.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { crewMenu, writeLlmChoice } from '../services/crew-menu.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
// The longest one tool call waits for a trial: the same constant the catalog's wait_seconds bound names.
import { MAX_WAIT_SECONDS } from '../tool-catalog/input-schemas.js';

function refusalText(r: CrewRefusal): string {
    return JSON.stringify({ error: { code: r.code, message: r.message, details: r.details } }, null, 2);
}

function ok(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function refused(r: CrewRefusal) {
    return { content: [{ type: 'text' as const, text: refusalText(r) }], isError: true };
}

export function registerAgentCrewTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    sessionScopes: string[],
): void {
    const deps = { storage, config };
    const callerOf = (pipeline: string): CrewCaller => {
        const principal = getAgentGaii();
        return {
            principal,
            owner: localAccountName(principal),
            scopes: sessionScopes,
            // An MCP session is an agent of the owner; a session minted on an owner JWT carries no '#'.
            roles: principal.includes('#') ? ['agent'] : ['owner'],
            pipeline,
        };
    };

    mcp.tool(
        'aimeat_crew_get',
        descriptionFor('aimeat_crew_get'),
        zodShapeFor('aimeat_crew_get'),
        annotationsFor('aimeat_crew_get'),
        async ({ target_agent_name }) => {
            const out = await crewState(deps, callerOf('mcp.crew_get'), target_agent_name);
            if (!out.ok) return refused(out);
            return ok(crewData(out));
        },
    );

    mcp.tool(
        'aimeat_crew_validate',
        descriptionFor('aimeat_crew_validate'),
        zodShapeFor('aimeat_crew_validate'),
        annotationsFor('aimeat_crew_validate'),
        async ({ target_agent_name, doc }) => {
            const out = await crewValidate(deps, callerOf('mcp.crew_validate'), target_agent_name, doc);
            if (!out.ok) return refused(out);
            return ok({ valid: out.valid, errors: out.errors });
        },
    );

    mcp.tool(
        'aimeat_crew_try',
        descriptionFor('aimeat_crew_try'),
        zodShapeFor('aimeat_crew_try'),
        annotationsFor('aimeat_crew_try'),
        async ({ target_agent_name, doc, prompt, try_id, wait_seconds }) => {
            const caller = callerOf('mcp.crew_try');
            const waitMs = Math.min(MAX_WAIT_SECONDS, wait_seconds ?? 50) * 1000;
            let id = try_id;
            if (doc) {
                if (!prompt) {
                    return refused({ ok: false, status: 400, code: 'PROMPT_REQUIRED', message: 'A trial needs a prompt: say what the crew should do in this run.' });
                }
                const started = await crewTryStart(deps, caller, target_agent_name, doc, prompt);
                if (!started.ok) return refused(started);
                id = started.try_id;
            }
            if (!id) {
                return refused({ ok: false, status: 400, code: 'DOC_OR_TRY_ID_REQUIRED', message: 'Pass doc and prompt to start a trial, or try_id to keep waiting on one.' });
            }
            const out = await crewTryWait(deps, caller, target_agent_name, id, waitMs);
            if (!out.ok) return refused(out);
            const data = crewData(out);
            return ok(data.status === 'running'
                ? { ...data, next: `Still running. Call aimeat_crew_try again with try_id "${id}" to keep waiting.` }
                : data);
        },
    );

    mcp.tool(
        'aimeat_crew_draft',
        descriptionFor('aimeat_crew_draft'),
        zodShapeFor('aimeat_crew_draft'),
        annotationsFor('aimeat_crew_draft'),
        async ({ target_agent_name, doc }) => {
            const caller = callerOf('mcp.crew_draft');
            const out = doc
                ? await crewDraftSave(deps, caller, target_agent_name, doc)
                : await crewDraftDiscard(deps, caller, target_agent_name);
            if (!out.ok) return refused(out);
            return ok(crewData(out));
        },
    );

    mcp.tool(
        'aimeat_crew_publish',
        descriptionFor('aimeat_crew_publish'),
        zodShapeFor('aimeat_crew_publish'),
        annotationsFor('aimeat_crew_publish'),
        async ({ target_agent_name, doc, revision }) => {
            const caller = callerOf('mcp.crew_publish');
            if (!doc && revision === undefined) {
                return refused({ ok: false, status: 400, code: 'DOC_OR_REVISION_REQUIRED', message: 'Pass doc to publish a definition, or revision to restore a kept one.' });
            }
            const out = doc
                ? await crewPublish(deps, caller, target_agent_name, doc)
                : await crewRestore(deps, caller, target_agent_name, revision as number);
            if (!out.ok) return refused(out);
            return ok({ published: true, revision: out.revision, publishedAt: out.publishedAt, key: out.key, warnings: out.warnings });
        },
    );

    mcp.tool(
        'aimeat_crew_seed',
        descriptionFor('aimeat_crew_seed'),
        zodShapeFor('aimeat_crew_seed'),
        annotationsFor('aimeat_crew_seed'),
        async ({ target_agent_name, doc, validate_with }) => {
            const out = await crewSeed(deps, callerOf('mcp.crew_seed'), target_agent_name, doc, validate_with);
            if (!out.ok) return refused(out);
            return ok({ seeded: true, revision: out.revision, publishedAt: out.publishedAt, key: out.key, validated_by: out.validatedBy, warnings: out.warnings });
        },
    );

    // What the RUNTIME offers, asked rather than guessed. The fixed tool list in this node's own
    // publish description drifted two names behind crewaimeat's TOOL_REGISTRY; this is the runtime
    // answering for itself, and it carries the model profiles that machine can reach as well.
    mcp.tool(
        'aimeat_crew_menu',
        descriptionFor('aimeat_crew_menu'),
        zodShapeFor('aimeat_crew_menu'),
        annotationsFor('aimeat_crew_menu'),
        async ({ target_agent_name }) => {
            const out = await crewMenu(deps, callerOf('mcp.crew_menu'), target_agent_name);
            if (!out.ok) return refused(out);
            return ok(out.menu);
        },
    );

    // Which model an agent thinks with. Same service the web door calls, so a choice made in chat
    // and a choice made on the page cannot mean two different things.
    mcp.tool(
        'aimeat_crew_llm_set',
        descriptionFor('aimeat_crew_llm_set'),
        zodShapeFor('aimeat_crew_llm_set'),
        annotationsFor('aimeat_crew_llm_set'),
        async ({ target_agent_name, choice }) => {
            const caller = callerOf('mcp.crew_llm_set');
            let name: string | null = null;
            if (target_agent_name) {
                // Resolved before writing, so a typo becomes a refusal rather than a record under a
                // key no runtime will ever read.
                const target = await resolveCrewAgent(deps, caller, target_agent_name);
                if (!target.ok) return refused(target);
                name = target.agent.name;
            }
            const out = await writeLlmChoice(deps, caller, name, choice ?? null);
            if (!out.ok) return refused(out);
            return ok({ key: out.key, cleared: out.cleared, scope: name ? 'agent' : 'default' });
        },
    );
}
