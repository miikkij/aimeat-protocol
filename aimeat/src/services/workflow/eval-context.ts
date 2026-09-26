/**
 * @file eval-context.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Builds the SignalEvalCtx the workflow engine hands to the pure signal evaluator —
 *   binding memory reads to OWNER-SCOPE (the owner GHII + every one of the owner's agents, the same
 *   aggregation as GET /v1/memory?owner_scope=true; +a sandbox keyPrefix), exposing the run's {var}
 *   params, and wiring the node-OpenRouter `llm` judge (only when the workflow's owner approved it).
 *   Owner-scope matters because pipeline agents write their deliverables into their OWN keyspaces.
 *   Extracted from engine.ts so the "how the engine reads memory / judges with an LLM for a signal"
 *   concern lives in one focused place. See docs/plans/2026-06-13-agent-workflows-node-plan.md §3.
 * @structure buildEvalCtx(storage, config, ownerGhii, run) → SignalEvalCtx
 * @usage import { buildEvalCtx } from './eval-context.js';
 * @version-history
 *   v1.0.0 — 2026-06-13 — Phase 5: extracted from engine.ts (keep the engine focused on the loop).
 *   v1.1.0 — 2026-06-13 — FIX: read OWNER-SCOPE (owner + all agents), not the owner GHII keyspace
 *     alone — agent-produced keys live in agent keyspaces, so cross-agent signals falsely counted 0.
 *   v1.2.0 — 2026-09-24 — A signal reads a record as the memory doors show it (shownMemoryValue), so
 *     a credential record reads as { configured: true } and neither the run nor the llm judge holds it.
 *   v1.3.0 — 2026-09-26 — The llm judge answers to the run's cost cap: what a call cost is kept on
 *     the run (`signalCostUsd`), and past maxCostUsd the judge is not asked and the leaf passes
 *     (secaudit 2026-09, A6-11).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { completeForOwner } from '../ai-completion.js';
import { validateValueAgainstSchema } from '../schema-validator.js';
import { listOwnerScopeMemory, getOwnerScopeMemory } from '../owner-memory.js';
import { shownMemoryValue } from '../secret-records.js';
import { globToRegExp, type SignalEvalCtx } from './signal-eval.js';
import { costCapReached, recordSignalCost } from './run-cost.js';
import type { WorkflowRun } from '../../models/workflow-schemas.js';

/**
 * The node-OpenRouter judge for `llm` leaves. Any failure degrades to a pass (never breaks a run).
 * It spends the owner's AI the way an ai step does, so it answers to the run's cap (run-cost.ts): what
 * a call cost is kept on the run, and once the run has spent maxCostUsd the judge is not asked and
 * the leaf passes, as it does when the judge is unavailable. The engine saves the run after it
 * evaluates, so the cost is kept with everything else the evaluation changed.
 */
function makeLlmJudge(storage: Storage, config: AimeatConfig, ownerGhii: string, run: WorkflowRun) {
  return async ({ content, ask }: { key: string; content: unknown; ask: string }): Promise<{ ok: boolean; reason: string }> => {
    if (costCapReached(run)) return { ok: true, reason: 'llm not asked: this run has spent its maxCostUsd — degraded to pass' };
    try {
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      const result = await completeForOwner(storage, config, ownerGhii, {
        prompt: `Answer strictly as JSON {"ok":boolean,"reason":string}. Question: ${ask}\n\nContent:\n${text.slice(0, 20_000)}`,
        appId: `workflow:${run.workflowId}`,
      });
      recordSignalCost(run, result.usage?.costUsd);
      const m = /\{[\s\S]*\}/.exec(result.content);
      if (!m) return { ok: true, reason: 'llm response unparseable — degraded to pass' };
      const parsed = JSON.parse(m[0]) as { ok?: boolean; reason?: string };
      return { ok: parsed.ok !== false, reason: parsed.reason ?? '' };
    } catch (err) {
      return { ok: true, reason: `llm unavailable (${String(err)}) — degraded to pass` };
    }
  };
}

/**
 * Build the signal-eval context bound to the owner namespace (+ keyPrefix for sandbox). The `llm`
 * leaf is enabled only when the workflow def carries owner approval; otherwise it is null and the
 * evaluator degrades llm leaves to a pass. json_schema is validated with the shared ajv (real check).
 */
export function buildEvalCtx(storage: Storage, config: AimeatConfig, ownerGhii: string, run: WorkflowRun): SignalEvalCtx {
  const prefix = run.keyPrefix ?? '';
  const ownerName = ownerGhii.split('@')[0];
  const llmEnabled = !!run.defSnapshot.llm?.approved;
  return {
    // OWNER-SCOPE reads: pipeline agents write their deliverables into their OWN (GAII) keyspaces, so
    // a signal over agent-produced keys must read across the owner's GHII + every agent (the same
    // aggregation as GET /v1/memory?owner_scope=true), not the owner GHII keyspace alone — otherwise
    // every cross-agent signal falsely counts 0 and the step goes RED.
    // What a signal sees of a record is what the memory doors show of it (services/secret-records.ts):
    // a credential reads as { configured: true }. The run keeps what a leaf saw, and the llm judge
    // sends it to the model, so neither ever holds the credential itself.
    read: async (key) => {
      const rec = await getOwnerScopeMemory(storage, config.nodeId, ownerName, prefix + key);
      return rec ? { key, value: shownMemoryValue(rec.key, rec.value) } : null;
    },
    listGlob: async (glob) => {
      const full = prefix + glob;
      const star = full.indexOf('*');
      const listPrefix = star >= 0 ? full.slice(0, star) : full;
      const recs = await listOwnerScopeMemory(storage, config.nodeId, ownerName, { prefix: listPrefix });
      const re = globToRegExp(full);
      return recs.filter(r => re.test(r.key)).map(r => ({ key: r.key.slice(prefix.length), value: shownMemoryValue(r.key, r.value) }));
    },
    vars: run.vars,
    llm: llmEnabled ? makeLlmJudge(storage, config, ownerGhii, run) : null,
    // Real ajv validation for the json_schema leaf — a step must NOT report success while producing
    // schema-invalid output (previously this degraded to json_valid → a false GREEN).
    validateJsonSchema: (value, schema) => validateValueAgainstSchema(value, schema),
  };
}
