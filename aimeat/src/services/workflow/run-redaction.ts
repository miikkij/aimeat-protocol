/**
 * @file src/services/workflow/run-redaction.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the run doors serve of a run: an observation of a credential record shows what
 *   the memory doors show of that record.
 *
 *   A run keeps what each signal leaf saw, and a json_field leaf keeps the field's value. A signal now
 *   reads a credential record as the memory doors show it (eval-context.ts), so a new run never holds
 *   one. A run recorded before that can, and GET /v1/workflows/:id/runs and /runs/:runId, the
 *   connector's twin and the MCP tools all read runs through store.ts listRuns and getRun, which pass
 *   every run through here. The same redaction as the memory doors (services/secret-records.ts): no
 *   second list of what counts as a credential.
 * @structure shownRun(run)
 * @usage return shownRun(rec.value as WorkflowRun);
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { isSecretRecordKey, shownMemoryValue } from '../secret-records.js';
import type { WorkflowRun } from '../../models/workflow-schemas.js';

/** What an llm leaf said about a credential record: its words can quote what it read. */
const WITHHELD_REASON = 'withheld: the record holds a credential';

/**
 * One observation tree with every leaf that names a credential record redacted. A leaf is the object
 * that carries `key`; the composites (`all`, `any`, `when`) are walked through.
 */
function shownObservation(observed: unknown): unknown {
    if (Array.isArray(observed)) return observed.map(shownObservation);
    if (!observed || typeof observed !== 'object') return observed;
    const leaf = observed as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(leaf)) out[field] = shownObservation(value);
    if (typeof leaf.key === 'string' && isSecretRecordKey(leaf.key)) {
        if ('value' in out) out.value = shownMemoryValue(leaf.key, leaf.value);
        if ('reason' in out) out.reason = WITHHELD_REASON;
    }
    return out;
}

/** A run as a door may serve it. Anything that is not a run's shape passes through untouched. */
export function shownRun(run: WorkflowRun): WorkflowRun {
    if (!run || typeof run !== 'object' || !run.steps || typeof run.steps !== 'object') return run;
    const steps: WorkflowRun['steps'] = {};
    for (const [id, step] of Object.entries(run.steps)) {
        if (!step || typeof step !== 'object') { steps[id] = step; continue; }
        steps[id] = {
            ...step,
            ...(step.inputObserved !== undefined ? { inputObserved: shownObservation(step.inputObserved) } : {}),
            ...(step.outputObserved !== undefined ? { outputObserved: shownObservation(step.outputObserved) } : {}),
        };
    }
    return { ...run, steps };
}
