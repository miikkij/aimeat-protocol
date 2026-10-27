/**
 * @file src/services/workflow/run-reader.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification reader a workflow step reads the owner's records with: the reader
 *   of the principal the run acts for.
 *
 *   WHY. A step read the owner's records with the node's system reader whoever the run acted for, so
 *   a run that acted for an agent skipped what the owner set for that agent: its clearance, a label's
 *   audience, and the rule that what a label hides from AI does not reach an AI or leave through one.
 *   The same agent reading the record directly is refused by those rules (secaudit2026oct26,
 *   workflow/engine-steps:step-reads-use-system-reader-not-run-principal). The scheduled ai job and the
 *   decide run already read as the agent (scheduler-ai-job.ts, decide/runs.ts).
 *
 *   WHO READS HOW. A run that acts for an agent reads as that agent (readerForAgent), so the agent
 *   reads in a workflow what it reads directly: an agent with no clearance, on records with no label
 *   that hides them from it, reads exactly as before, and classification switched off changes nothing.
 *   A run the owner started, an app's or an ecosystem app's run, and a run started before runs recorded
 *   a principal read as the node's own work, as before. The private-record reach itself
 *   (memory:read-as-owner) is asked before each dispatch (dispatch-authority.ts, step-authority.ts).
 * @structure runReader(deps, run, ownerGhii) · hiddenStepInputError(key, run, baseUrl)
 * @usage const reader = runReader(deps, run, ownerGhii);
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { WorkflowRun } from '../../models/workflow-schemas.js';
import { readerForAgent, systemReader, type ContentReader } from '../classification/reader.js';
import { parseGaiiLoose } from '../../utils/gaii.js';
import { agentPageUrl } from '../permission-ask.js';

/** The reader a step of `run` reads the owner's records with. */
export function runReader(deps: { storage: Storage; config: AimeatConfig }, run: Pick<WorkflowRun, 'principal'>, ownerGhii: string): ContentReader {
  const p = run.principal;
  return p?.kind === 'agent' ? readerForAgent(deps, p.id) : systemReader(deps, ownerGhii);
}

/**
 * The error a step ends with when a record it reads is hidden from the agent the run acts for: which
 * record, why, and where the owner changes it.
 */
export function hiddenStepInputError(key: string, run: Pick<WorkflowRun, 'principal'>, baseUrl: string): Error {
  const gaii = run.principal?.id ?? '';
  const name = parseGaiiLoose(gaii).agent || gaii;
  return new Error(`CLASSIFIED: "${key}" is hidden from ${name}, which this run acts for, by its clearance or by the record's label, `
    + `so the step did not run. The owner changes this on the agent's page: ${agentPageUrl(baseUrl, name)}`);
}
