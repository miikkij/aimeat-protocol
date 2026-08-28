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
 *   v1.0.0 -- 2026-08-28 -- Initial: the five tools over services/crew-ops.ts.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import {
    crewState, crewValidate, crewTryStart, crewTryWait, crewDraftSave, crewDraftDiscard, crewPublish, crewRestore, crewData,
    type CrewCaller, type CrewRefusal,
} from '../services/crew-ops.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

const DocSchema = z.record(z.string(), z.unknown());
const agentNameSchema = z.string().describe('The agent whose definition this is (bare name of one of your owner\'s agents, or its full GAII). An agent may name itself or a same-owner sibling.');

/** The longest one tool call waits for a trial before handing back a try_id to continue with. */
const MAX_WAIT_SECONDS = 120;

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
        const loose = parseGaiiLoose(principal);
        return {
            principal,
            owner: loose.owner,
            scopes: sessionScopes,
            // An MCP session is an agent of the owner; a session minted on an owner JWT carries no '#'.
            roles: principal.includes('#') ? ['agent'] : ['owner'],
            pipeline,
        };
    };

    mcp.tool(
        'aimeat_crew_get',
        descriptionFor('aimeat_crew_get'),
        { target_agent_name: agentNameSchema },
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
        {
            target_agent_name: agentNameSchema,
            doc: DocSchema.describe('The whole crew definition to check (target_agent_name, agents[], tasks[], …).'),
        },
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
        {
            target_agent_name: agentNameSchema,
            doc: DocSchema.optional().describe('Start a trial: the definition to run once. Omit when continuing to wait on a try_id.'),
            prompt: z.string().min(1).max(20_000).optional().describe('Start a trial: what the crew should do in this run (becomes {{ctx.prompt}}). Required with doc.'),
            try_id: z.string().optional().describe('Continue waiting on a trial this tool already started and returned as running.'),
            wait_seconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).optional().describe(`How long this call waits for the result before handing back the try_id (default 50, max ${MAX_WAIT_SECONDS}). Call again with try_id to keep waiting.`),
        },
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
        {
            target_agent_name: agentNameSchema,
            doc: DocSchema.optional().describe('The edits to keep. Omit it to discard the saved draft.'),
        },
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
        {
            target_agent_name: agentNameSchema,
            doc: DocSchema.optional().describe('The definition to make live. The agent\'s runtime validates it first; on problems nothing is written and the list comes back.'),
            revision: z.number().int().positive().optional().describe('Instead of doc: republish this kept revision (it goes through the validator and becomes a new revision).'),
        },
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
            return ok({ published: true, revision: out.revision, publishedAt: out.publishedAt, key: out.key });
        },
    );
}
