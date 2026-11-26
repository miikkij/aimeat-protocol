/**
 * @file src/tool-catalog/definitions/evals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalog entries of the stored eval sets (services/evals/): aimeat_eval_set,
 *   aimeat_eval_get, aimeat_eval_run. REST: routes/evals/evals.ts.
 * @structure evalTools — the three definitions
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-stored-eval-sets-for-crews-skills-and-library-packs-scored-p).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

const kind = { type: 'string' as const, enum: ['crew', 'skill', 'pack'], required: true, description: 'What is evaluated: a crew (one of your agents), a skill, or a library pack.' };
const name = { type: 'string' as const, required: true, description: 'The crew\'s agent name, the skill\'s ref or name (user:alice/my-skill, node:aimeat-writing), or the pack\'s id.' };

export const evalTools = [
  {
    name: 'aimeat_eval_set',
    description: 'Write the eval set for one crew, skill or library pack: up to 10 cases, each a prompt and 1 to 5 expectations a good answer meets (kind contains or not_contains with the words, or judge with a rubric a model reads and answers PASS or FAIL), and how many times each case runs (repeats, 1 to 5, default 3, because one run of a model proves little). It replaces the cases; the runs made of earlier cases stay. Write the cases from what the person said the crew or skill is for. Run it with aimeat_eval_run.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Eval set: write', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'memory:write',
    surfaces: ['agent'],
    input: {
      kind, name,
      cases: {
        type: 'array',
        required: true,
        description: 'The cases: [{ id (short, lowercase), prompt, expect: [{ kind: "contains" | "not_contains" | "judge", value }] }], at most 10.',
        zod: z.array(z.object({
          id: z.string().max(40),
          prompt: z.string().max(2000),
          expect: z.array(z.object({ kind: z.enum(['contains', 'not_contains', 'judge']), value: z.string().max(2000) })).max(5),
        })).max(10),
      },
      repeats: { type: 'number', description: 'How many times each case runs, 1 to 5 (default 3).', zod: z.number().int().min(1).max(5) },
    },
  },
  {
    name: 'aimeat_eval_get',
    description: 'Read the eval set of one crew, skill or library pack with its runs, newest first: each run says the revision it measured, the score with the target (and, for a skill or a pack, without it, so the difference is what the text changes), the cases that failed and why (a judge\'s verdict is marked as a model\'s), and the score of the revision before with the change. A run still going says running.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Eval set: read', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scope: 'memory:read',
    surfaces: ['agent'],
    input: { kind, name },
  },
  {
    name: 'aimeat_eval_run',
    description: 'Run the eval set of one crew, skill or library pack against what it is now, and score it against the run of the revision before. A crew runs each case on its own runtime, as aimeat_crew_try does; a skill or a pack runs each case on your AI twice, with its text and without. Every model call spends this account\'s AI allowance, so ask the person first and say what it costs: dry_run: true answers how many model calls and crew trials a run makes, and runs nothing. Without dry_run the run starts in the background; read it with aimeat_eval_get.',
    caller: 'agent',
    visibility: agentEverywhere,
    annotations: { title: 'Eval set: run', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    scope: 'ai:use',
    surfaces: ['agent'],
    input: {
      kind, name,
      dry_run: { type: 'boolean', description: 'true: answer what a run would cost, and run nothing.' },
    },
  },
] as const satisfies readonly AimeatToolDefinition[];
