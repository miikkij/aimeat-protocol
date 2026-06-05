/**
 * @file eval.ts
 * @description Offline evaluator for SynthTraces JSONL. Derives protocol-
 *   correctness metrics from recorded tool calls + native task state — this is
 *   what turns the traces into both a benchmark ("can this model drive AIMEAT?")
 *   and a fine-tuning signal. Pure analysis: no node, no LLM, no spend.
 * @structure CHECKS, evaluateTrace(), main()
 * @usage
 *   cd aimeat
 *   pnpm exec tsx tools/synthtraces/src/eval.ts --in=tools/synthtraces/out/traces-openrouter.jsonl
 * @version-history
 *   v0.1.0 -- 2026-06-05 -- Initial eval layer
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { AGENT_TOOLS } from './tools.js';
import type { SessionTrace, ToolCallEntry } from './trace.js';

const KNOWN_TOOLS = new Set<string>([...AGENT_TOOLS.map((t) => t.name), 'task_start(owner)', 'task_telemetry(harness)']);
const VALID_VISIBILITY = new Set(['private', 'public', 'shared']);

interface CheckResult {
  id: string;
  pass: boolean;
  detail?: string;
}

/** Each check returns pass/fail with an optional reason. AIMEAT-specific where it can be. */
function evaluateTrace(t: SessionTrace): { checks: CheckResult[]; score: number } {
  const calls = t.tool_calls ?? [];
  const agentCalls = calls.filter((c) => c.name !== 'task_start(owner)');
  const memWrites = agentCalls.filter((c) => c.name === 'aimeat_memory_write');
  const okMemWrites = memWrites.filter((c) => c.ok);
  const workCalls = agentCalls.filter((c) => c.ok && (c.name === 'aimeat_memory_write' || c.name === 'aimeat_task_event'));
  const completeIdx = calls.findIndex((c) => c.name === 'aimeat_complete_task' && c.ok);

  const unknown = calls.filter((c) => !KNOWN_TOOLS.has(c.name)).map((c) => c.name);
  const failed = calls.filter((c) => !c.ok).map((c) => `${c.name}(${c.status})`);
  const badVis = memWrites
    .map((c) => (c.input as { visibility?: unknown })?.visibility)
    .filter((v) => v !== undefined && !VALID_VISIBILITY.has(String(v)));
  const badKeys = memWrites.filter((c) => {
    const k = (c.input as { key?: unknown })?.key;
    return typeof k !== 'string' || k.trim().length === 0;
  });
  // "Completed after real work": a successful work call must precede the successful complete.
  const firstWorkIdx = calls.findIndex((c) => c.ok && (c.name === 'aimeat_memory_write' || c.name === 'aimeat_task_event'));
  const completedAfterWork = completeIdx === -1 ? false : firstWorkIdx !== -1 && firstWorkIdx < completeIdx;

  const checks: CheckResult[] = [
    { id: 'task_reached_done', pass: t.task.final_status === 'done' },
    { id: 'outcome_completed', pass: t.outcome === 'completed' },
    { id: 'no_hallucinated_tools', pass: unknown.length === 0, detail: unknown.join(', ') || undefined },
    { id: 'no_failed_tool_calls', pass: failed.length === 0, detail: failed.join(', ') || undefined },
    { id: 'persisted_something', pass: okMemWrites.length > 0 },
    { id: 'valid_memory_visibility', pass: badVis.length === 0, detail: badVis.join(', ') || undefined },
    { id: 'valid_memory_keys', pass: badKeys.length === 0 },
    { id: 'completed_after_real_work', pass: completedAfterWork },
  ];
  const score = checks.filter((c) => c.pass).length / checks.length;
  return { checks, score };
}

function main(): void {
  const inArg = process.argv.find((a) => a.startsWith('--in='));
  if (!inArg) {
    console.error('usage: eval.ts --in=<traces.jsonl>');
    process.exit(2);
  }
  const file = inArg.slice('--in='.length);
  const traces = readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SessionTrace);

  const agg: Record<string, { pass: number; total: number }> = {};
  const perTrace: { session: string; persona: string; model: string; score: number; fails: string[] }[] = [];
  let totalScore = 0;

  for (const t of traces) {
    const { checks, score } = evaluateTrace(t);
    totalScore += score;
    const fails: string[] = [];
    for (const c of checks) {
      agg[c.id] ??= { pass: 0, total: 0 };
      agg[c.id].total++;
      if (c.pass) agg[c.id].pass++;
      else fails.push(c.detail ? `${c.id}(${c.detail})` : c.id);
    }
    perTrace.push({ session: t.session_id.slice(0, 8), persona: t.persona_id, model: t.agent_model, score, fails });
  }

  const n = traces.length || 1;
  console.log(`\n=== SynthTraces eval — ${traces.length} trace(s) from ${file} ===`);
  console.log(`mean score: ${(totalScore / n).toFixed(3)}`);
  console.log('\nper-check pass rate:');
  for (const [id, s] of Object.entries(agg)) {
    const pct = ((s.pass / s.total) * 100).toFixed(0);
    console.log(`  ${(s.pass === s.total ? 'PASS' : 'FAIL').padEnd(5)} ${id.padEnd(28)} ${s.pass}/${s.total} (${pct}%)`);
  }
  console.log('\nper-trace:');
  for (const p of perTrace) {
    console.log(`  ${p.persona.padEnd(20)} score=${p.score.toFixed(2)} ${p.fails.length ? 'FAILS: ' + p.fails.join('; ') : 'all pass'}`);
  }

  // Token cost + transport mix (what to observe alongside the score).
  const tok = traces.reduce(
    (a, t) => ({
      in: a.in + (t.usage?.tokensIn ?? 0),
      out: a.out + (t.usage?.tokensOut ?? 0),
      calls: a.calls + (t.usage?.aiCalls ?? 0),
      dur: a.dur + (t.usage?.durationSeconds ?? 0),
    }),
    { in: 0, out: 0, calls: 0, dur: 0 },
  );
  const viaMix: Record<string, number> = {};
  for (const t of traces) for (const c of t.tool_calls ?? []) if (c.via) viaMix[c.via] = (viaMix[c.via] ?? 0) + 1;
  console.log(
    `\ntoken cost: in=${tok.in} out=${tok.out} aiCalls=${tok.calls} dur=${tok.dur.toFixed(1)}s ` +
      `(mean ${Math.round((tok.in + tok.out) / n)} tok/session)`,
  );
  console.log(`transport mix (tool calls): ${JSON.stringify(viaMix)}`);

  const outFile = file.replace(/\.jsonl$/, '') + '.eval.json';
  writeFileSync(
    outFile,
    JSON.stringify({ file, count: traces.length, meanScore: totalScore / n, perCheck: agg, usageTotals: tok, viaMix, perTrace }, null, 2),
  );
  console.log(`\nEval written to: ${outFile}`);
}

main();
