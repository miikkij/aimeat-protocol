/**
 * @file src/tool-catalog/definitions/calibrator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_calibrator: the owner's Prompt Calibrator from the chat, in ONE tool with an
 *   `action` parameter for its fifteen routes (/v1/calibrator), as aimeat_app_manage and
 *   aimeat_receiver are (the developer's ruling of 2026-09-27: a new capability is one tool with an
 *   action). On all three surfaces: the node's MCP endpoint (src/mcp/calibrator.ts), the connector MCP
 *   and the CLI dispatch (src/tool-dispatch/tool-call-defs-calibrator.ts), the last two over the
 *   routes. One implementation: services/calibrator/projects.ts.
 *
 *   ONE TABLE. CALIBRATOR_ACTIONS is the only place an action's fields, required fields, permission
 *   word and summary are written. The catalog input, the description's action list, the per-action
 *   permission (catalog/action-scopes.ts) and checkCalibratorInput(), which the node MCP and the CLI
 *   dispatch call before anything else, are derived from it.
 * @structure CALIBRATOR_ACTIONS · CALIBRATOR_ACTION_NAMES · CALIBRATOR_BODY_FIELDS · checkCalibratorInput ·
 *   calibratorTools
 * @usage const checked = checkCalibratorInput(input); if (!checked.ok) return toolError('INVALID_INPUT', checked.message);
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: the calibrator had no chat path, only its page and REST (feature
 *     audit 2026-11-19, 4.4 item 5).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

// utils/scope-coverage.ts READ_AS_OWNER_SCOPE and WRITE_AS_OWNER_SCOPE, the words the routes ask.
const READ = 'memory:read-as-owner';
const WRITE = 'memory:write-as-owner';

interface CalibratorAction { fields: Record<string, boolean>; scope: string; summary: string }

const PROJECT_FIELDS = {
    project_id: true, name: false, reasoning_llm: false, candidate_models: false, status: false,
    analysis_prompt_template: false, reflection_prompt_template: false, self_reflection_prompt_template: false, synthesis_prompt_template: false,
};

/** action → { fields (true = required), permission word, what it does }. A write needs WRITE as well as READ. */
export const CALIBRATOR_ACTIONS: Record<string, CalibratorAction> = {
    templates: { fields: {}, scope: READ, summary: 'the four default prompt templates a new project starts with' },
    list: { fields: {}, scope: READ, summary: 'every project, newest first, with its batch count, the latest average score and how many models it tests' },
    get: { fields: { project_id: true }, scope: READ, summary: 'one project and the dimensions found so far' },
    detail: { fields: { project_id: true }, scope: READ, summary: 'one project whole: its dimensions, its versions, the current version and its batches' },
    versions: { fields: { project_id: true }, scope: READ, summary: 'the prompt versions, oldest first' },
    version: { fields: { project_id: true, version: true }, scope: READ, summary: 'one prompt version whole: its prompt, target output and changelog' },
    batches: { fields: { project_id: true, version: false }, scope: READ, summary: 'the test batches, newest first, each model\'s score; `version` keeps those of one version' },
    batch: { fields: { project_id: true, batch_id: true }, scope: READ, summary: 'one batch whole: each model\'s four steps' },
    create: { fields: { name: true }, scope: WRITE, summary: 'a new project with the default templates and no models' },
    update: { fields: PROJECT_FIELDS, scope: WRITE, summary: 'set the named fields of a project: name, reasoning_llm (the judge), candidate_models, status or a template' },
    delete: { fields: { project_id: true }, scope: WRITE, summary: 'remove a project with its versions, batches and dimensions' },
    version_create: { fields: { project_id: true, prompt: true, target_output: false, changelog: false }, scope: WRITE, summary: 'the next prompt version: the prompt, the output it should give, and what changed' },
    batch_create: { fields: { project_id: true, version: true }, scope: WRITE, summary: 'an empty batch of the project\'s candidate models for one version' },
    batch_update: { fields: { project_id: true, batch_id: true, models: false, status: false, step4_synthesis: false }, scope: WRITE, summary: 'set a batch\'s models (their step results), status or synthesis; the dimensions in the analysis results join the project\'s' },
    batch_delete: { fields: { project_id: true, batch_id: true }, scope: WRITE, summary: 'remove one batch' },
};

export const CALIBRATOR_ACTION_NAMES = Object.keys(CALIBRATOR_ACTIONS);

/** Tool field → the route's body field, for the actions that send a body. */
export const CALIBRATOR_BODY_FIELDS: Record<string, string> = {
    name: 'name', reasoning_llm: 'reasoningLlm', candidate_models: 'candidateModels', status: 'status',
    analysis_prompt_template: 'analysisPromptTemplate', reflection_prompt_template: 'reflectionPromptTemplate',
    self_reflection_prompt_template: 'selfReflectionPromptTemplate', synthesis_prompt_template: 'synthesisPromptTemplate',
    prompt: 'prompt', target_output: 'targetOutput', changelog: 'changelog',
    version: 'promptVersion', models: 'models', step4_synthesis: 'step4_synthesis',
};

/** The checks the three interfaces run before calling anything: a known action, its required fields, and no other field. */
export function checkCalibratorInput(input: Record<string, unknown>): { ok: true; action: string } | { ok: false; message: string } {
    const action = typeof input.action === 'string' ? input.action : '';
    const spec = CALIBRATOR_ACTIONS[action];
    if (!spec) return { ok: false, message: `action must be one of: ${CALIBRATOR_ACTION_NAMES.join(', ')}.${action ? ` "${action}" is not one.` : ''}` };
    const missing = Object.entries(spec.fields).filter(([f, req]) => req && (input[f] === undefined || input[f] === null || input[f] === '')).map(([f]) => f);
    if (missing.length) return { ok: false, message: `action "${action}" needs ${missing.join(', ')}.` };
    const allowed = new Set(['action', ...Object.keys(spec.fields)]);
    const extra = Object.keys(input).filter(k => !allowed.has(k) && input[k] !== undefined);
    if (extra.length) return { ok: false, message: `action "${action}" takes no ${extra.join(', ')}.` };
    return { ok: true, action };
}

/** The body an action sends: the fields it takes, renamed to the route's, those given only. */
export function calibratorBody(action: string, input: Record<string, unknown>): Record<string, unknown> {
    const fields = Object.keys(CALIBRATOR_ACTIONS[action]?.fields ?? {});
    return Object.fromEntries(fields
        .filter(f => f !== 'project_id' && f !== 'batch_id' && input[f] !== undefined && CALIBRATOR_BODY_FIELDS[f])
        .map(f => [CALIBRATOR_BODY_FIELDS[f], input[f]]));
}

const actionList = CALIBRATOR_ACTION_NAMES.map(a => `"${a}" (${CALIBRATOR_ACTIONS[a].summary}${CALIBRATOR_ACTIONS[a].scope === WRITE ? '; a change' : ''})`).join('; ');

export const calibratorTools = [
    {
        name: 'aimeat_calibrator',
        description: 'The owner\'s Prompt Calibrator: projects that test one prompt on several AI models against the output it should give, version by version, and collect what to change in the prompt. The same projects the person sees on the Calibrator page (/v1/profile?tab=calibrator). '
            + 'A project holds the candidate models, a judge model (reasoning_llm) and four prompt templates; each prompt version holds the prompt, the target output and a changelog; a batch runs one version on every candidate in four steps (1 generate, 2 analyze against the target, 3 reflect, 4 synthesize proposals) and keeps each model\'s results. The page runs the models; you read the results, add a version with a better prompt, and record results you produced yourself with batch_update. '
            + `Actions: ${actionList}. `
            + 'Reading needs memory:read-as-owner, the permission to read your owner\'s private records; a change also needs memory:write-as-owner. Your owner ticks each for you in Profile > Agents; "Full access" does not give the first. '
            + 'Refusals come back as CODE: message with the codes the /v1/calibrator routes answer (NOT_FOUND, INVALID_BODY, INVALID_INPUT, SCOPE_DENIED).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Prompt Calibrator', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        // The word every /v1/calibrator route admits an agent with; a change also asks memory:write-as-owner
        // (catalog/action-scopes.ts).
        scope: READ,
        surfaces: ['agent'],
        input: {
            // batch_delete last: the parameter-forwarding probe holds `action` at the last value.
            action: { type: 'string', required: true, enum: CALIBRATOR_ACTION_NAMES, description: 'What to do. Start with "list", then "detail" of one project.' },
            project_id: { type: 'string', description: 'The project, from "list" (projectId). Every action but templates, list and create.' },
            batch_id: { type: 'string', description: 'For batch, batch_update and batch_delete: the batch, from "batches" or "detail".' },
            version: { type: 'number', description: 'For version and batch_create: the prompt version number; for batches, only that version\'s batches.' },
            name: { type: 'string', description: 'For create and update: the project\'s name.' },
            reasoning_llm: { type: 'object', description: 'For update: the judge model that analyses, reflects and synthesises, as the page stores it ({ modelId, label, provider, ... }), or null.', zod: z.record(z.string(), z.unknown()).nullable() },
            candidate_models: { type: 'array', description: 'For update: the models under test, each { id, label, modelId, ... } as the page stores it. Replaces the list.' },
            status: { type: 'string', description: 'For update: the project\'s status (such as "active" or "archived"); for batch_update: the batch\'s (such as "running" or "done").' },
            analysis_prompt_template: { type: 'string', description: 'For update: the analysis template ({TARGET_OUTPUT}, {CANDIDATE_OUTPUT}, {MODEL_NAME}, {PROMPT_USED}).' },
            reflection_prompt_template: { type: 'string', description: 'For update: the reflection template.' },
            self_reflection_prompt_template: { type: 'string', description: 'For update: the self-reflection template.' },
            synthesis_prompt_template: { type: 'string', description: 'For update: the synthesis template.' },
            prompt: { type: 'string', description: 'For version_create: the prompt being calibrated.' },
            target_output: { type: 'string', description: 'For version_create: the output a perfect answer gives.' },
            changelog: { type: 'string', description: 'For version_create: what changed from the version before.' },
            models: { type: 'array', description: 'For batch_update: the batch\'s models with their step results (step1_generation, step2_analysis, step3_reflection), read with "batch" and changed. Replaces the list.' },
            step4_synthesis: { type: 'object', description: 'For batch_update: the synthesis of the proposals.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
