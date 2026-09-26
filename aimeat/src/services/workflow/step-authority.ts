/**
 * @file src/services/workflow/step-authority.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The permission words a principal needs to put a step in a workflow, and to start a
 *   run of one.
 *
 *   A workflow runs its steps with the owner's authority, and nobody sits at the screen while it
 *   does: an ai step spends the owner's AI budget, a datapackage step publishes an owner record as a
 *   public package, an extension step runs an action as the operator, and an ecosystem step pushes
 *   owner data to a connected app. `workflow:write` says only "may author workflows", so a principal
 *   holding it and nothing else could do each of those through a step while the door that does the
 *   same thing directly refused it. Now each kind of step costs the word its own door costs, and the
 *   workflow is checked when it is saved and again when a run is started, for the principal that
 *   saves or starts it. The account holder in person passes, as requireScope lets them pass every
 *   door. A run started by the workflow's own trigger has no caller to ask; it answers to the
 *   principal that saved the workflow, whose words are asked again when it starts
 *   (trigger-authority.ts).
 * @structure STEP_KIND_SCOPES · LLM_SCOPES · MEMORY_READ_SCOPES · WorkflowCaller · ownerInPerson(caller) ·
 *   saverFromCaller(caller, ownerGhii) · missingStepScopes(def, caller, mode) · stepScopeRefusal(missing)
 * @usage
 *   const missing = missingStepScopes(def, caller, 'full');
 *   if (missing.length > 0) return stepScopeRefusal(missing);   // 403 SCOPE_DENIED, the words named
 * @version-history
 *   v1.2.0 — 2026-09-25 — WorkflowCaller carries who the caller is, and saverFromCaller turns it into
 *     the saver a save records, for the trigger's check of that saver's words at start.
 *   v1.1.1 — 2026-09-24 — ownerInPerson asks utils/scope-coverage.ts ownerBypassesScopes, which the
 *     package install now asks too; the rule is written once.
 *   v1.1.0 — 2026-09-24 — A workflow that reads the owner's records costs memory:read, on a check
 *     too: every signal leaf reads a record and the run keeps what it saw, which workflow:read serves.
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { scopeIsCovered, ownerBypassesScopes } from '../../utils/scope-coverage.js';
import type { WorkflowStep, Signal, WorkflowSaver } from '../../models/workflow-schemas.js';

/** Every kind of step. A step with no `action` is an agent step. */
export type StepKind = 'agent' | 'human-input' | 'ai' | 'extension' | 'datapackage' | 'export-out' | 'trigger-geai';

/**
 * The words each kind of step costs: what the door that does the same thing directly asks for.
 *
 * A kind with no words acts through somebody else's grant or through the owner in person. An agent
 * step hands a task to one of the owner's agents, which then works on its own permissions; the task
 * door (POST /v1/agents/:name/tasks) lets a same-owner agent do that without a word of its own. A
 * human-input step asks the owner.
 */
export const STEP_KIND_SCOPES: Readonly<Record<StepKind, readonly string[]>> = {
    agent: [],
    'human-input': [],
    // The owner's model and budget: every AI door asks ai:use (auth/ai-gate.ts, the AI jobs routes).
    ai: ['ai:use'],
    // An installed extension's action, run as the operator: the MCP door's word (aimeat_extension_invoke).
    extension: ['ext:invoke'],
    // An owner record read and published as a public package: the read, then POST /v1/datapackages,
    // which asks storage:write and memory:write.
    datapackage: ['memory:read', 'storage:write', 'memory:write'],
    // An owner record read and handed to a connected app: the read, then the capability invoke door.
    'export-out': ['memory:read', 'work:request'],
    // A connected app's capability, invoked: POST /v1/capabilities/:id/invoke.
    'trigger-geai': ['work:request'],
};

/**
 * `llm.approved` switches on the node's model as the judge of the workflow's `llm` signals, which
 * spends the owner's AI budget on every check and every run. Approving it is that spend.
 */
export const LLM_SCOPES: readonly string[] = ['ai:use'];

/**
 * Reading the owner's records is the memory door's read. A signal is such a read: every leaf reads a
 * record by key or by key pattern, and the run keeps what it saw (a json_field leaf keeps the field's
 * value), which workflow:read then serves. So a workflow that reads costs memory:read, on a check as
 * on a run.
 */
export const MEMORY_READ_SCOPES: readonly string[] = ['memory:read'];

/** Does this signal tree hold a leaf? Every leaf reads a record. */
function hasLeaf(signal: Signal | 'none' | undefined): boolean {
    if (!signal || signal === 'none') return false;
    if ('all' in signal) return signal.all.some(hasLeaf);
    if ('any' in signal) return signal.any.some(hasLeaf);
    if ('when' in signal) return hasLeaf(signal.when) || hasLeaf(signal.then);
    return 'kind' in signal;
}

/**
 * Does this step read the owner's records? Its own signals do. An agent step inherits its offer's
 * signals, which an offer must publish to be used at all. A key a step writes its answer to is judged
 * by the signal that reads it back (store.ts synthesises it). An ai step hands records to the model,
 * and a datapackage or export-out step reads the record it sends on.
 */
function readsOwnerRecords(step: Pick<WorkflowStep, 'action' | 'success_signal' | 'required_to_function'>): boolean {
    if (hasLeaf(step.success_signal) || hasLeaf(step.required_to_function)) return true;
    const a = step.action;
    if (!a || a.kind === 'agent') return true;
    if (a.kind === 'ai') return !!(a.prompt_key || a.input_keys?.length || a.result_to_key);
    if (a.kind === 'extension') return !!a.result_to_key;
    if (a.kind === 'human-input') return !!a.answer_to_key;
    return a.kind === 'datapackage' || a.kind === 'export-out';
}

/** Who saves or starts the workflow, in the terms every door can supply. */
export interface WorkflowCaller {
    roles: string[];
    scopes: string[];
    federated?: boolean;
    /** Who this is, as the save records it: resolveIdentity() on HTTP, the agent's GAII over MCP. */
    principal?: string;
    /** The grant a hosted app's token was issued under: the app's own identity carries the owner's name. */
    appGrant?: string;
}

/**
 * The principal a save records as its saver, and the trigger later asks again. The owner in person
 * is not checked at the trigger, as no door checks them; everything else is found again by the id
 * this returns, so a token's own name is not enough for an app, whose token names the owner.
 */
export function saverFromCaller(caller: WorkflowCaller, ownerGhii: string): WorkflowSaver {
    if (ownerInPerson(caller)) return { kind: 'owner', id: ownerGhii };
    if (caller.roles.includes('app')) return { kind: 'app', id: caller.appGrant ?? caller.principal ?? '' };
    if (caller.roles.includes('ecosystem')) return { kind: 'ecosystem', id: caller.principal ?? '' };
    return { kind: 'agent', id: caller.principal ?? '' };
}

/**
 * The account holder in person, whom requireScope waves through every door. The rule lives in
 * utils/scope-coverage.ts ownerBypassesScopes, beside the rule for what a scope covers.
 */
export function ownerInPerson(caller: WorkflowCaller): boolean {
    return ownerBypassesScopes(caller);
}

function kindOf(step: Pick<WorkflowStep, 'action'>): StepKind {
    return (step.action?.kind ?? 'agent') as StepKind;
}

/** One word the caller lacks, with the first step that needs it, so a refusal can point at it. */
export interface MissingStepScope { scope: string; step: string; kind: StepKind | 'llm' | 'read' }

/**
 * The words this workflow needs that the caller does not hold, each once. A signals-only check
 * dispatches no step, so it is asked about the records it reads and the model that judges the `llm`
 * signals; a full run and a save are asked about every step as well.
 */
export function missingStepScopes(
    def: {
        steps: Array<Pick<WorkflowStep, 'id' | 'action' | 'success_signal' | 'required_to_function'>>;
        llm?: { approved?: boolean };
    },
    caller: WorkflowCaller,
    mode: 'save' | 'full' | 'signals-only',
): MissingStepScope[] {
    if (ownerInPerson(caller)) return [];
    const needs: MissingStepScope[] = [];
    const need = (scope: string, step: string, kind: MissingStepScope['kind']): void => {
        if (!needs.some(n => n.scope === scope)) needs.push({ scope, step, kind });
    };
    if (mode !== 'signals-only') {
        for (const step of def.steps) {
            const kind = kindOf(step);
            for (const scope of STEP_KIND_SCOPES[kind] ?? []) need(scope, step.id, kind);
        }
    }
    for (const step of def.steps) {
        if (readsOwnerRecords(step)) for (const scope of MEMORY_READ_SCOPES) need(scope, step.id, 'read');
    }
    if (def.llm?.approved) for (const scope of LLM_SCOPES) need(scope, '', 'llm');
    return needs.filter(n => !scopeIsCovered(caller.scopes, n.scope));
}

/**
 * A step id as the refusal shows it. The id is the author's own text, and the HTTP door repeats the
 * message in a WWW-Authenticate header, where a character outside printable ASCII would throw.
 */
function shownStepId(id: string): string {
    return id.replace(/[^\x20-\x7e]/g, '?');
}

/** The refusal: 403 SCOPE_DENIED, the missing words, and which step asks for each. */
export function stepScopeRefusal(missing: MissingStepScope[]): { status: 403; code: 'SCOPE_DENIED'; needed: string[]; message: string } {
    const why = missing.map(m => (m.kind === 'llm'
        ? `"${m.scope}" (llm.approved lets the node's model judge the signals)`
        : m.kind === 'read'
            ? `"${m.scope}" (step "${shownStepId(m.step)}" reads the owner's records)`
            : `"${m.scope}" (step "${shownStepId(m.step)}" is ${m.kind === 'ai' || m.kind === 'extension' || m.kind === 'export-out' ? 'an' : 'a'} ${m.kind} step)`));
    return {
        status: 403, code: 'SCOPE_DENIED',
        needed: missing.map(m => m.scope),
        message: `This workflow needs ${why.join(', ')}, and this session does not carry ${missing.length === 1 ? 'it' : 'them'}. `
            + 'A step does what its own door does, so it costs the same permission. The owner grants it in the permissions of this agent or app.',
    };
}
