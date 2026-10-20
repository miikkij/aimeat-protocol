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
 *
 *   The second rule here is who may read an observation at all. A json_field leaf holds the field
 *   value of one of the owner's records, and an llm leaf's `reason` can quote what the model read.
 *   A caller that does not read the owner's records as the owner (services/owner-scope-read.ts) gets
 *   those values withheld, and keeps every step's green or red state.
 * @structure shownRun(run) · withoutObservedValues(run)
 * @usage return shownRun(rec.value as WorkflowRun);
 * @version-history
 *   v1.1.0 — 2026-10-20 — withoutObservedValues: a caller that does not read as the owner is served
 *     the run without its observed values. The run doors gave any caller holding workflow:read the
 *     owner's private field values out of a run the owner had started in person (secaudit 2026-10,
 *     wf-preflight-skips-step-authority, the related run-read gap).
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
    return mapObservations(run, shownObservation);
}

/** What an observed value reads as for a caller that does not read the owner's records as the owner. */
export const WITHHELD_NOT_AS_OWNER = 'withheld: this session does not read the owner\'s records as the owner';

/**
 * One observation tree with every leaf's value and reason withheld. The leaf keeps its key, its op
 * and the verdict fields the page draws green or red from; only what was READ out of the record is
 * removed, because that is the record's content and not the run's outcome.
 */
function withoutLeafValues(observed: unknown): unknown {
    if (Array.isArray(observed)) return observed.map(withoutLeafValues);
    if (!observed || typeof observed !== 'object') return observed;
    const leaf = observed as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(leaf)) out[field] = withoutLeafValues(value);
    if (typeof leaf.key === 'string') {
        if ('value' in out) { out.value = null; out.withheld = WITHHELD_NOT_AS_OWNER; }
        if ('reason' in out) { out.reason = WITHHELD_NOT_AS_OWNER; out.withheld = WITHHELD_NOT_AS_OWNER; }
    }
    return out;
}

/**
 * A run as a door may serve it to a caller that does not read the owner's records as the owner: the
 * steps, their states and their keys, without the values the signals read out of the records.
 */
export function withoutObservedValues(run: WorkflowRun): WorkflowRun {
    return mapObservations(run, withoutLeafValues);
}

/** Apply one observation rewrite to every step's inputObserved and outputObserved. */
function mapObservations(run: WorkflowRun, rewrite: (observed: unknown) => unknown): WorkflowRun {
    if (!run || typeof run !== 'object' || !run.steps || typeof run.steps !== 'object') return run;
    const steps: WorkflowRun['steps'] = {};
    for (const [id, step] of Object.entries(run.steps)) {
        if (!step || typeof step !== 'object') { steps[id] = step; continue; }
        steps[id] = {
            ...step,
            ...(step.inputObserved !== undefined ? { inputObserved: rewrite(step.inputObserved) } : {}),
            ...(step.outputObserved !== undefined ? { outputObserved: rewrite(step.outputObserved) } : {}),
        };
    }
    return { ...run, steps };
}
