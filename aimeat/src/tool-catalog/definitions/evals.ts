/**
 * @file src/tool-catalog/definitions/evals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalog entries of the stored eval sets (services/evals/): aimeat_eval_set,
 *   aimeat_eval_get, aimeat_eval_run. REST: routes/evals/evals.ts.
 * @structure evalTools — the three definitions
 * @version-history
 *   v1.2.0 — 2026-11-27 — aimeat_eval_run: the caller's own AI answers and judges; run_id, results and
 *     model finish an open run; the scope is memory:write, as the node spends no AI on it.
 *   v1.1.0 — 2026-11-26 — aimeat_eval_set takes remove; cases is required only without it.
 *   v1.0.0 — 2026-11-26 — Initial (wish-stored-eval-sets-for-crews-skills-and-library-packs-scored-p).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

const kind = { type: 'string' as const, enum: ['crew', 'skill', 'pack'], required: true, description: 'What is evaluated: a crew (one of your agents), a skill, or a library pack.' };
const name = { type: 'string' as const, required: true, description: 'The crew\'s agent name, the skill\'s ref or name (user:alice/my-skill, node:aimeat-app-builder-atelier), or the pack\'s id.' };

export const evalTools = [
  {
    name: 'aimeat_eval_set',
    description: 'Write the eval set for one crew, skill or library pack: up to 10 cases, each a prompt and 1 to 5 expectations a good answer meets (kind contains or not_contains with the words, which the node checks, or judge with a rubric your own AI reads at run time and answers true or false), and how many times each case runs (repeats, 1 to 5, default 3, because one run of a model proves little). It replaces the cases; the runs made of earlier cases stay. Write the cases from what the person said the crew or skill is for. Run it with aimeat_eval_run. remove: true removes the set with its runs instead (send no cases), also when the crew or skill it names is gone.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Eval set: write', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'memory:write',
    surfaces: ['agent'],
    input: {
      kind, name,
      cases: {
        type: 'array',
        description: 'The cases: [{ id (short, lowercase), prompt, expect: [{ kind: "contains" | "not_contains" | "judge", value }] }], at most 10. Required unless remove is true.',
        zod: z.array(z.object({
          id: z.string().max(40),
          prompt: z.string().max(2000),
          expect: z.array(z.object({ kind: z.enum(['contains', 'not_contains', 'judge']), value: z.string().max(2000) })).max(5),
        })).max(10),
      },
      repeats: { type: 'number', description: 'How many times each case runs, 1 to 5 (default 3).', zod: z.number().int().min(1).max(5) },
      remove: { type: 'boolean', description: 'true: remove the set with its runs, and write nothing.' },
    },
  },
  {
    name: 'aimeat_eval_get',
    description: 'Read the eval set of one crew, skill or library pack with its runs, newest first: each run says the revision it measured, the score with the target (and, for a skill or a pack, without it, so the difference is what the text changes), the cases that failed and why (a judge\'s verdict is marked as the caller\'s), the model the caller named, and the score of the revision before with the change. A crew run still collecting trials says running; a run waiting for your answers or verdicts says open, and a crew\'s open run lists its answers under pending.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Eval set: read', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'memory:read',
    surfaces: ['agent'],
    input: { kind, name },
  },
  {
    name: 'aimeat_eval_run',
    description: 'Run the eval set of one crew, skill or library pack against what it is now, and score it against the run of the revision before. The node calls no model: YOU answer and judge, on your own model. For a skill or a pack the call opens a run and answers with the exact text of the current revision and the cases: answer every case `repeats` times twice, each in a fresh context (a subagent) that sees nothing else, once with the text as its only instructions (arm "with") and once with no instructions (arm "without"); give true or false for each judge rubric of the case, in order; then call this again with run_id and results, every case, arm and repeat once. Send the answers as written: the node grades the words itself. A crew runs each case on its own runtime, as aimeat_crew_try does; when the set has a judge, aimeat_eval_get then shows the run open with the crew\'s answers, and you send the verdicts the same way (arm "with", no answer). A new start closes a run still waiting. dry_run: true says how many answers, verdicts and crew trials a run asks, and starts nothing.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Eval set: run', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    scope: 'memory:write',
    surfaces: ['agent'],
    input: {
      kind, name,
      dry_run: { type: 'boolean', description: 'true: say what a run asks, and start nothing.' },
      run_id: { type: 'string', description: 'The open run to finish, from the start\'s answer or aimeat_eval_get. With it, send results.' },
      model: { type: 'string', description: 'The model that wrote the answers and verdicts, as you name it (claude-opus-5-5); stored with the run.' },
      results: {
        type: 'array',
        description: 'With run_id: [{ case, arm: "with" | "without", repeat: 1..repeats, answer, verdicts: [true | false per judge rubric, in order] }]. A crew run takes verdicts only (arm "with", no answer).',
        zod: z.array(z.object({
          case: z.string().max(40),
          arm: z.enum(['with', 'without']).optional(),
          repeat: z.number().int().min(1).max(5),
          answer: z.string().max(20_000).optional(),
          verdicts: z.array(z.boolean()).max(5).optional(),
        })).max(100),
      },
    },
  },
] as const satisfies readonly AimeatToolDefinition[];
