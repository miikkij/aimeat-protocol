/**
 * @file eval-context.ts
 * @description Builds the SignalEvalCtx the workflow engine hands to the pure signal evaluator —
 *   binding memory reads to the owner namespace (+ a sandbox keyPrefix), exposing the run's {var}
 *   params, and wiring the node-OpenRouter `llm` judge (only when the workflow's owner approved it).
 *   Extracted from engine.ts so the "how the engine reads memory / judges with an LLM for a signal"
 *   concern lives in one focused place. See docs/plans/2026-06-13-agent-workflows-node-plan.md §3.
 * @structure buildEvalCtx(storage, config, ownerGhii, run) → SignalEvalCtx
 * @usage import { buildEvalCtx } from './eval-context.js';
 * @version-history
 *   v1.0.0 — 2026-06-13 — Phase 5: extracted from engine.ts (keep the engine focused on the loop).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { completeForOwner } from '../ai-completion.js';
import { globToRegExp, type SignalEvalCtx } from './signal-eval.js';
import type { WorkflowRun } from '../../models/workflow-schemas.js';

/** The node-OpenRouter judge for `llm` leaves. Any failure degrades to a pass (never breaks a run). */
function makeLlmJudge(storage: Storage, config: AimeatConfig, ownerGhii: string, workflowId: string) {
  return async ({ content, ask }: { key: string; content: unknown; ask: string }): Promise<{ ok: boolean; reason: string }> => {
    try {
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      const result = await completeForOwner(storage, config, ownerGhii, {
        prompt: `Answer strictly as JSON {"ok":boolean,"reason":string}. Question: ${ask}\n\nContent:\n${text.slice(0, 20_000)}`,
        appId: `workflow:${workflowId}`,
      });
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
 * evaluator degrades llm leaves to a pass. json_schema degrades to json_valid (no validator injected).
 */
export function buildEvalCtx(storage: Storage, config: AimeatConfig, ownerGhii: string, run: WorkflowRun): SignalEvalCtx {
  const prefix = run.keyPrefix ?? '';
  const llmEnabled = !!run.defSnapshot.llm?.approved;
  return {
    read: async (key) => {
      const rec = await storage.getMemory(ownerGhii, prefix + key);
      return rec ? { key, value: rec.value } : null;
    },
    listGlob: async (glob) => {
      const full = prefix + glob;
      const star = full.indexOf('*');
      const listPrefix = star >= 0 ? full.slice(0, star) : full;
      const recs = await storage.listMemory(ownerGhii, { prefix: listPrefix });
      const re = globToRegExp(full);
      return recs.filter(r => re.test(r.key)).map(r => ({ key: r.key.slice(prefix.length), value: r.value }));
    },
    vars: run.vars,
    llm: llmEnabled ? makeLlmJudge(storage, config, ownerGhii, run.workflowId) : null,
    // validateJsonSchema intentionally omitted → the evaluator degrades json_schema to json_valid.
  };
}
